"""WebSocket Manager for CardFlow remote multiplayer sessions."""
import asyncio
from typing import Optional

from fastapi import WebSocket


class WebSocketManager:
    """Manages active WebSocket connections per session and role.

    Internal structure:
        _connections: dict[session_id, dict[role, WebSocket]]
        _timers: dict[session_id + role, asyncio.Task] — reconnect timers
    """

    def __init__(self) -> None:
        # session_id (str) -> { "player": WebSocket, "opponent": WebSocket }
        self._connections: dict[str, dict[str, WebSocket]] = {}
        # key = f"{session_id}:{role}" -> asyncio.Task for reconnect timeout
        self._timers: dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def get_active_roles(self, session_id: str) -> list[str]:
        """Return the list of roles currently connected for a session."""
        return list(self._connections.get(session_id, {}).keys())

    def is_full(self, session_id: str) -> bool:
        """Return True if both player and opponent slots are occupied."""
        return len(self._connections.get(session_id, {})) >= 2

    async def connect(self, session_id: str, role: str, websocket: WebSocket) -> None:
        """Register a WebSocket connection for the given session and role.

        Cancels any pending reconnect timer for this slot.
        """
        if session_id not in self._connections:
            self._connections[session_id] = {}
        self._connections[session_id][role] = websocket

        # Cancel reconnect timer if one was running for this slot
        timer_key = f"{session_id}:{role}"
        if timer_key in self._timers:
            self._timers[timer_key].cancel()
            del self._timers[timer_key]

    def disconnect(self, session_id: str, role: str) -> None:
        """Remove a WebSocket connection from the registry."""
        session_conns = self._connections.get(session_id)
        if session_conns and role in session_conns:
            del session_conns[role]
        if session_id in self._connections and not self._connections[session_id]:
            del self._connections[session_id]

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    async def broadcast(self, session_id: str, message: dict) -> None:
        """Send a message to all connected clients in a session."""
        for ws in list(self._connections.get(session_id, {}).values()):
            try:
                await ws.send_json(message)
            except Exception:
                pass  # stale connection — ignore, disconnect handled elsewhere

    async def send_to_role(
        self, session_id: str, role: str, message: dict
    ) -> None:
        """Send a message to a specific role in a session."""
        ws = self._connections.get(session_id, {}).get(role)
        if ws is not None:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Reconnect timer helpers (used by the WS handler)
    # ------------------------------------------------------------------

    def start_reconnect_timer(
        self,
        session_id: str,
        role: str,
        timeout_seconds: int,
        callback,  # coroutine function(session_id, role)
    ) -> None:
        """Start a timer that fires *callback* if the client doesn't reconnect."""
        timer_key = f"{session_id}:{role}"

        async def _timer():
            await asyncio.sleep(timeout_seconds)
            await callback(session_id, role)

        task = asyncio.create_task(_timer())
        self._timers[timer_key] = task

    def cancel_reconnect_timer(self, session_id: str, role: str) -> None:
        """Cancel a pending reconnect timer."""
        timer_key = f"{session_id}:{role}"
        task = self._timers.pop(timer_key, None)
        if task:
            task.cancel()


# Module-level singleton shared across the application
websocket_manager = WebSocketManager()
