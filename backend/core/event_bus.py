import asyncio
import json
from typing import Any, Callable, Awaitable
from collections import defaultdict


class EventBus:
    """Async event bus for simulation events. Supports typed subscriptions and WebSocket forwarding."""

    def __init__(self):
        self._subscribers: dict[str, list[Callable[[Any], Awaitable[None]]]] = defaultdict(list)
        self._ws_connections: list[Any] = []  # WebSocket connections to forward events to
        self._event_log: list[Any] = []  # Full event history for replay/caching

    def subscribe(self, event_type: str, handler: Callable[[Any], Awaitable[None]]) -> Callable:
        """Subscribe to events of a given type. Returns unsubscribe function."""
        self._subscribers[event_type].append(handler)

        def unsubscribe():
            self._subscribers[event_type].remove(handler)

        return unsubscribe

    def register_ws(self, ws) -> None:
        """Register a WebSocket connection to receive all events."""
        self._ws_connections.append(ws)

    def unregister_ws(self, ws) -> None:
        """Remove a WebSocket connection."""
        if ws in self._ws_connections:
            self._ws_connections.remove(ws)

    async def publish(self, event) -> None:
        """Publish an event to all subscribers and WebSocket connections."""
        event_type = getattr(event, "type", None) or type(event).__name__
        self._event_log.append(event)

        # Notify typed subscribers
        tasks = []
        for handler in self._subscribers.get(event_type, []):
            tasks.append(handler(event))
        # Also notify wildcard subscribers
        for handler in self._subscribers.get("*", []):
            tasks.append(handler(event))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # Forward to WebSocket connections
        await self._broadcast_ws(event)

    async def _broadcast_ws(self, event) -> None:
        """Send event to all connected WebSocket clients."""
        if not self._ws_connections:
            return

        if hasattr(event, "model_dump"):
            data = event.model_dump()
        elif hasattr(event, "dict"):
            data = event.dict()
        else:
            data = {"type": "unknown", "data": str(event)}

        message = json.dumps(data, default=str)

        dead = []
        for ws in self._ws_connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self._ws_connections.remove(ws)

    def get_event_log(self) -> list:
        """Return full event history for caching/replay."""
        return list(self._event_log)

    def clear_log(self) -> None:
        """Clear event history."""
        self._event_log.clear()
