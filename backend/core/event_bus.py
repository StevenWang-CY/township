import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from .types import is_private_event

logger = logging.getLogger(__name__)


class EventBus:
    """Async event bus for simulation events. Supports typed subscriptions and WebSocket forwarding."""

    # A browser that stops reading must not hold a simulation hostage. This
    # Each actual write is bounded, and each socket may accumulate only this
    # many live messages behind its replay. Publishers enqueue in O(1); a slow
    # browser can therefore lose its own connection but never stall a run.
    WS_SEND_TIMEOUT_SECONDS = 2.0
    WS_LIVE_BACKLOG_LIMIT = 256

    def __init__(self):
        self._subscribers: dict[str, list[Callable[[Any], Awaitable[None]]]] = defaultdict(list)
        self._ws_connections: list[Any] = []  # WebSocket connections to forward events to
        self._ws_queues: dict[Any, asyncio.Queue] = {}
        self._ws_writer_tasks: dict[Any, asyncio.Task] = {}
        # Serializes the point where an event joins WebSocket history and the
        # set of sockets eligible for its live broadcast is captured.  A late
        # subscriber therefore receives an event either in its replay or as a
        # live message, never both (and never neither).
        self._ws_state_lock = asyncio.Lock()
        # Complete wire messages for the current/latest run.  Unlike the
        # diagnostic tail below, this resets on ``simulation_started`` and is
        # intentionally not capped so late joiners can reconstruct a run from
        # its authoritative envelope.
        self._ws_run_history: list[str] = []
        # A bounded diagnostic tail for status/debugging. Persisted runs use an
        # explicit recorder so long simulations never lose their early events.
        self._event_log: list[Any] = []
        self._recorders: dict[str, list[Any]] = {}

    def subscribe(self, event_type: str, handler: Callable[[Any], Awaitable[None]]) -> Callable:
        """Subscribe to events of a given type. Returns unsubscribe function."""
        self._subscribers[event_type].append(handler)

        def unsubscribe():
            if handler in self._subscribers[event_type]:
                self._subscribers[event_type].remove(handler)

        return unsubscribe

    def register_ws(self, ws) -> None:
        """Register a WebSocket without replaying history.

        The application endpoint uses :meth:`subscribe_ws` instead.  This
        synchronous helper remains useful for internal/test clients that only
        need future events.
        """
        if ws not in self._ws_connections:
            self._ws_connections.append(ws)
        self._ws_queues.setdefault(ws, asyncio.Queue(maxsize=self.WS_LIVE_BACKLOG_LIMIT))

    async def subscribe_ws(self, ws) -> bool:
        """Atomically register *ws* and replay the current/latest run.

        Replay messages are enqueued before the socket becomes visible to
        publishers. Live events committed afterward join the same FIFO, so
        the history/live cut is exact without blocking publishers on network
        I/O. The caller waits until hydration itself succeeds so the endpoint
        never reports a dead socket as connected.

        Returns ``False`` when replay discovers a dead socket; cleanup is
        idempotent and concurrent publishers will simply skip that socket.
        """
        async with self._ws_state_lock:
            if ws in self._ws_connections:
                return True
            replay = list(self._ws_run_history)
            queue: asyncio.Queue = asyncio.Queue(maxsize=len(replay) + self.WS_LIVE_BACKLOG_LIMIT)
            hydrated = asyncio.get_running_loop().create_future()
            for index, message in enumerate(replay):
                completion = hydrated if index == len(replay) - 1 else None
                queue.put_nowait((message, completion))
            if not replay:
                hydrated.set_result(True)
            self._ws_connections.append(ws)
            self._ws_queues[ws] = queue
            self._ensure_ws_writer(ws)

        return bool(await hydrated) and ws in self._ws_connections

    def unregister_ws(self, ws) -> None:
        """Remove a WebSocket connection (safe to call more than once)."""
        if ws in self._ws_connections:
            self._ws_connections.remove(ws)
        queue = self._ws_queues.pop(ws, None)
        if queue is not None:
            while not queue.empty():
                try:
                    _, completion = queue.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover - defensive
                    break
                if completion is not None and not completion.done():
                    completion.set_result(False)
        task = self._ws_writer_tasks.pop(ws, None)
        if task is not None and not task.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:  # called outside a running loop
                current = None
            if task is not current:
                task.cancel()

    def _ensure_ws_writer(self, ws) -> None:
        task = self._ws_writer_tasks.get(ws)
        if task is None or task.done():
            self._ws_writer_tasks[ws] = asyncio.create_task(self._ws_writer(ws))

    async def _ws_writer(self, ws) -> None:
        """Drain one socket's FIFO; evict it on timeout or disconnect."""
        completion = None
        try:
            while ws in self._ws_connections:
                queue = self._ws_queues.get(ws)
                if queue is None:
                    return
                message, completion = await queue.get()
                try:
                    await asyncio.wait_for(
                        ws.send_text(message),
                        timeout=self.WS_SEND_TIMEOUT_SECONDS,
                    )
                except Exception:
                    if completion is not None and not completion.done():
                        completion.set_result(False)
                    self.unregister_ws(ws)
                    return
                if completion is not None and not completion.done():
                    completion.set_result(True)
        except asyncio.CancelledError:
            # A backlog eviction can cancel the writer while the hydration
            # marker is already in flight (and therefore no longer drainable
            # from the queue). Never strand subscribe_ws on that future.
            if completion is not None and not completion.done():
                completion.set_result(False)
            return

    def _enqueue_ws(self, ws, message: str, completion=None) -> bool:
        """Queue one ordered write, evicting a client whose backlog is full."""
        queue = self._ws_queues.get(ws)
        if queue is None or ws not in self._ws_connections:
            if completion is not None and not completion.done():
                completion.set_result(False)
            return False
        try:
            queue.put_nowait((message, completion))
        except asyncio.QueueFull:
            logger.warning("Evicting a WebSocket client whose live backlog is full")
            self.unregister_ws(ws)
            if completion is not None and not completion.done():
                completion.set_result(False)
            return False
        self._ensure_ws_writer(ws)
        return True

    def start_recording(self) -> str:
        """Start an unbounded, run-scoped event capture and return its token."""
        token = uuid.uuid4().hex
        self._recorders[token] = []
        return token

    def stop_recording(self, token: str) -> list[Any]:
        """Finish a run-scoped capture and return its complete event sequence."""
        return self._recorders.pop(token, [])

    # Cap event-log growth to avoid unbounded memory in long-running servers.
    EVENT_LOG_LIMIT = 5000

    async def publish(self, event) -> None:
        """Publish an event to all subscribers and WebSocket connections."""
        if is_private_event(event):
            logger.warning(
                "Dropping deprecated private event type before shared publication: %s",
                getattr(event, "type", None),
            )
            return
        event_type = getattr(event, "type", None) or type(event).__name__
        message = self._serialize_event(event)

        async with self._ws_state_lock:
            self._event_log.append(event)
            for recording in self._recorders.values():
                recording.append(event)
            if len(self._event_log) > self.EVENT_LOG_LIMIT:
                # Drop oldest events while keeping the tail.
                self._event_log = self._event_log[-self.EVENT_LOG_LIMIT :]

            if event_type == "simulation_started":
                self._ws_run_history = [message]
            elif self._ws_run_history:
                self._ws_run_history.append(message)

            # This recipient snapshot is part of the same atomic commit as the
            # history append.  A concurrently subscribing socket is therefore
            # on exactly one side of the replay/live boundary.
            recipients = list(self._ws_connections)
            for ws in recipients:
                self._enqueue_ws(ws, message)

        # Notify typed subscribers
        tasks = []
        for handler in self._subscribers.get(event_type, []):
            tasks.append(handler(event))
        # Also notify wildcard subscribers
        for handler in self._subscribers.get("*", []):
            tasks.append(handler(event))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    @staticmethod
    def _serialize_event(event) -> str:
        """Return the canonical JSON message used for replay and live delivery."""
        if hasattr(event, "model_dump"):
            data = event.model_dump()
        elif hasattr(event, "dict"):
            data = event.dict()
        else:
            data = {"type": "unknown", "data": str(event)}
        return json.dumps(data, default=str)

    async def _broadcast_ws(self, message: str, recipients: list[Any]) -> None:
        """Compatibility helper: enqueue an ordered event without network wait."""
        for ws in recipients:
            self._enqueue_ws(ws, message)

    async def send_ws_text(self, ws, message: str) -> bool:
        """Serialize one socket write and absorb disconnect races.

        The WebSocket endpoint also uses this for pong replies, so control
        traffic can never overlap a broadcast on the same ASGI connection.
        """
        completion = asyncio.get_running_loop().create_future()
        if not self._enqueue_ws(ws, message, completion):
            return False
        return bool(await completion)

    def get_event_log(self) -> list:
        """Return the bounded diagnostic event-history tail."""
        return list(self._event_log)

    def clear_log(self) -> None:
        """Clear event history."""
        self._event_log.clear()
