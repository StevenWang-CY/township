"""
File-backed persistence primitives.

Township deliberately persists to plain JSON files instead of a database:
runs are append-only artifacts, and the mutable state (player relationships,
journals) is small and per-process. Three primitives cover all of it:

- ``save_json_atomic(path, obj)`` — the temp-file + ``os.replace`` pattern
  (extracted from ``orchestrator.save_cache``) so a crash mid-write can
  never leave a torn file behind.
- ``load_json(path, default)`` — best-effort read that returns ``default``
  on a missing or corrupt file instead of raising.
- ``DebouncedSaver`` — coalesces bursts of ``mark_dirty()`` calls into one
  atomic write every ``interval`` seconds, with ``aflush()`` for shutdown.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# township/ — anchored on this file (backend/core/storage.py → repo root).
PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Mutable per-deployment state (relationships, journals). Gitignored.
# Overridable via TOWNSHIP_STATE_DIR (read once, at import) so tests and
# embedders keep their state out of the repo.
STATE_DIR = Path(
    os.environ.get("TOWNSHIP_STATE_DIR") or PROJECT_ROOT / "data" / "state"
)


def runs_root() -> Path:
    """Directory that holds persisted simulation runs (``runs/<run_id>/``).

    Overridable via ``TOWNSHIP_RUNS_DIR`` so tests and embedders can point
    it anywhere without patching module attributes.
    """
    override = os.environ.get("TOWNSHIP_RUNS_DIR")
    return Path(override) if override else PROJECT_ROOT / "runs"


def save_json_atomic(path: Path | str, obj: Any, minify: bool = False) -> None:
    """Serialize ``obj`` to JSON at ``path`` atomically.

    Writes to a temp file in the destination directory, then ``os.replace``s
    it over ``path`` — readers only ever see the old file or the complete new
    one. ``minify=True`` drops whitespace (demo caches, event logs); the
    default matches the human-inspectable ``indent=2`` the simulation cache
    has always used. Non-JSON-native values fall back to ``str()``.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            if minify:
                json.dump(obj, f, separators=(",", ":"), default=str)
            else:
                json.dump(obj, f, indent=2, default=str)
        os.replace(tmp_name, path)
    except Exception:
        # Clean up the temp file on failure so we don't leave debris.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def load_json(path: Path | str, default: Any = None) -> Any:
    """Read JSON from ``path``; return ``default`` when missing or corrupt."""
    path = Path(path)
    if not path.is_file():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Could not load %s (%s) — using default", path, e)
        return default


class DebouncedSaver:
    """Coalesce frequent state mutations into periodic atomic writes.

    Call ``mark_dirty()`` after every mutation; the saver schedules one write
    ``interval`` seconds later, absorbing any further mutations in between.
    Call ``await aflush()`` on shutdown to cancel the pending timer and write
    immediately. When no event loop is running (sync scripts, unit tests),
    ``mark_dirty()`` degrades to an immediate synchronous write.
    """

    def __init__(
        self,
        path: Path | str,
        get_state: Callable[[], Any],
        *,
        interval: float = 5.0,
        minify: bool = False,
    ) -> None:
        self.path = Path(path)
        self._get_state = get_state
        self._interval = interval
        self._minify = minify
        self._dirty = False
        self._task: asyncio.Task | None = None

    def mark_dirty(self) -> None:
        """Record that state changed; schedule (or piggyback on) a flush."""
        self._dirty = True
        if self._task is not None and not self._task.done():
            return  # a flush is already scheduled — this change rides along
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop — write synchronously so nothing is ever lost.
            self._write()
            return
        self._task = loop.create_task(self._flush_after_interval())

    async def _flush_after_interval(self) -> None:
        await asyncio.sleep(self._interval)
        if self._dirty:
            self._write()

    async def aflush(self) -> None:
        """Cancel any pending timer and persist immediately (shutdown path)."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        if self._dirty:
            self._write()

    def _write(self) -> None:
        self._dirty = False
        try:
            save_json_atomic(self.path, self._get_state(), minify=self._minify)
        except Exception as e:
            # Never let a persistence hiccup take down the caller; the next
            # mutation re-marks dirty and retries.
            self._dirty = True
            logger.error("DebouncedSaver write to %s failed: %s", self.path, e)
