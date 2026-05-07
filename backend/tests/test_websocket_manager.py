"""Unit tests for WebSocketManager — connect/disconnect/broadcast.

Validates: Requirements 3.5
"""
import asyncio
from unittest.mock import AsyncMock

import pytest

from app.services.websocket_manager import WebSocketManager


def make_ws() -> AsyncMock:
    """Return a mock WebSocket with an async send_json."""
    ws = AsyncMock()
    ws.send_json = AsyncMock()
    return ws


# ---------------------------------------------------------------------------
# connect / is_full
# ---------------------------------------------------------------------------

def test_connect_registers_connection():
    mgr = WebSocketManager()
    ws = make_ws()
    asyncio.run(mgr.connect("s1", "player", ws))
    assert "player" in mgr.get_active_roles("s1")


def test_is_full_returns_true_when_two_connections():
    mgr = WebSocketManager()
    asyncio.run(mgr.connect("s1", "player", make_ws()))
    asyncio.run(mgr.connect("s1", "opponent", make_ws()))
    assert mgr.is_full("s1") is True


def test_is_full_returns_false_when_one_connection():
    mgr = WebSocketManager()
    asyncio.run(mgr.connect("s1", "player", make_ws()))
    assert mgr.is_full("s1") is False


def test_connect_third_role_would_be_blocked_by_is_full():
    """The route handler checks is_full() before calling connect.
    After two connections, is_full() returns True, so a third connect
    would be rejected by the handler — not by connect() itself.
    """
    mgr = WebSocketManager()
    asyncio.run(mgr.connect("s1", "player", make_ws()))
    asyncio.run(mgr.connect("s1", "opponent", make_ws()))

    # Guard pattern used by the route handler
    assert mgr.is_full("s1") is True, "Handler would reject a third connection here"


# ---------------------------------------------------------------------------
# broadcast
# ---------------------------------------------------------------------------

def test_broadcast_sends_to_both_clients():
    mgr = WebSocketManager()
    ws_player = make_ws()
    ws_opponent = make_ws()
    asyncio.run(mgr.connect("s1", "player", ws_player))
    asyncio.run(mgr.connect("s1", "opponent", ws_opponent))

    msg = {"type": "test"}
    asyncio.run(mgr.broadcast("s1", msg))

    ws_player.send_json.assert_awaited_once_with(msg)
    ws_opponent.send_json.assert_awaited_once_with(msg)


def test_broadcast_sends_to_single_client():
    mgr = WebSocketManager()
    ws = make_ws()
    asyncio.run(mgr.connect("s1", "player", ws))

    msg = {"type": "ping"}
    asyncio.run(mgr.broadcast("s1", msg))

    ws.send_json.assert_awaited_once_with(msg)


# ---------------------------------------------------------------------------
# disconnect
# ---------------------------------------------------------------------------

def test_disconnect_removes_connection():
    mgr = WebSocketManager()
    asyncio.run(mgr.connect("s1", "player", make_ws()))
    mgr.disconnect("s1", "player")
    assert "player" not in mgr.get_active_roles("s1")


def test_disconnect_cleans_up_empty_session():
    mgr = WebSocketManager()
    asyncio.run(mgr.connect("s1", "player", make_ws()))
    asyncio.run(mgr.connect("s1", "opponent", make_ws()))
    mgr.disconnect("s1", "player")
    mgr.disconnect("s1", "opponent")
    # Session key should be fully removed when no connections remain
    assert "s1" not in mgr._connections


# ---------------------------------------------------------------------------
# send_to_role
# ---------------------------------------------------------------------------

def test_send_to_role_sends_only_to_target():
    mgr = WebSocketManager()
    ws_player = make_ws()
    ws_opponent = make_ws()
    asyncio.run(mgr.connect("s1", "player", ws_player))
    asyncio.run(mgr.connect("s1", "opponent", ws_opponent))

    msg = {"type": "move"}
    asyncio.run(mgr.send_to_role("s1", "player", msg))

    ws_player.send_json.assert_awaited_once_with(msg)
    ws_opponent.send_json.assert_not_awaited()
