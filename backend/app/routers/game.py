import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt
from sqlmodel import Session

from app.auth import SECRET_KEY, ALGORITHM, verify_token
from app.schemas import (
    MoveRequest,
    SessionCreateRequest,
    SessionResponse,
    ValidMovesResponse,
    OwnerEnum,
    GameModeEnum,
    DifficultyEnum,
    BoardPieceState,
    JoinSessionRequest,
)
from app.services import session_manager
from app.services.websocket_manager import websocket_manager

router = APIRouter(prefix="/game", tags=["game"])

RECONNECT_TIMEOUT = 60  # seconds


def get_session():
    from app.main import engine
    with Session(engine) as session:
        yield session


def _to_session_response(game_session) -> SessionResponse:
    board = [BoardPieceState(**p) for p in game_session.board_state]
    # Extract breach activations from the session if stored
    breach_activations = []
    if hasattr(game_session, "_breach_activations") and game_session._breach_activations:
        breach_activations = list(game_session._breach_activations)
    return SessionResponse(
        session_id=game_session.id,
        game_mode=GameModeEnum(game_session.game_mode),
        current_turn=OwnerEnum(game_session.current_turn),
        winner=game_session.winner,
        board_state=board,
        breach_activations=breach_activations,
        status=game_session.status,
        player_user_id=game_session.player_user_id,
        opponent_user_id=game_session.opponent_user_id,
        difficulty=game_session.difficulty,
    )


@router.post(
    "/session",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    body: SessionCreateRequest,
    db: Session = Depends(get_session),
    user_id: str = Depends(verify_token),
):
    game_session = session_manager.create_session(body, db, user_id=user_id)
    return _to_session_response(game_session)


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    status_code=status.HTTP_200_OK,
)
def get_session_endpoint(
    session_id: uuid.UUID,
    db: Session = Depends(get_session),
    _: str = Depends(verify_token),
):
    game_session = session_manager.get_session(session_id, db)
    return _to_session_response(game_session)


@router.post(
    "/{session_id}/move",
    response_model=SessionResponse,
    status_code=status.HTTP_200_OK,
)
def apply_move(
    session_id: uuid.UUID,
    body: MoveRequest,
    db: Session = Depends(get_session),
    _: str = Depends(verify_token),
):
    game_session = session_manager.apply_move(session_id, body, db)
    return _to_session_response(game_session)


@router.post(
    "/{session_id}/join",
    response_model=SessionResponse,
    status_code=status.HTTP_200_OK,
)
async def join_session(
    session_id: uuid.UUID,
    body: JoinSessionRequest,
    db: Session = Depends(get_session),
    user_id: str = Depends(verify_token),
):
    game_session = session_manager.join_session(session_id, user_id, body.opponent_piece_ids, db)
    # Notify P1 via WS that opponent joined
    await websocket_manager.send_to_role(
        str(session_id), "player", {"type": "opponent_joined"}
    )
    # Also broadcast board_update so both clients get the updated board with P2's pieces
    await websocket_manager.broadcast(str(session_id), _build_board_update(game_session))
    return _to_session_response(game_session)


@router.get(
    "/{session_id}/valid-moves/{piece_id}",
    response_model=ValidMovesResponse,
    status_code=status.HTTP_200_OK,
)
def get_valid_moves(
    session_id: uuid.UUID,
    piece_id: uuid.UUID,
    db: Session = Depends(get_session),
    _: str = Depends(verify_token),
):
    moves = session_manager.get_valid_moves(session_id, piece_id, db)
    return ValidMovesResponse(piece_id=piece_id, moves=moves)


# ---------------------------------------------------------------------------
# WebSocket endpoint — WS /game/{session_id}/ws?token=<jwt>
# ---------------------------------------------------------------------------

def _decode_ws_token(token: str) -> Optional[str]:
    """Decode a JWT and return the 'sub' claim, or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def _build_board_update(game_session) -> dict:
    """Build a board_update message from a GameSession ORM object."""
    msg = {
        "type": "board_update",
        "board_state": game_session.board_state,
        "current_turn": game_session.current_turn,
        "winner": game_session.winner,
        "game_mode": game_session.game_mode,
    }
    if hasattr(game_session, "_breach_activations") and game_session._breach_activations:
        msg["breach_activations"] = [
            b.model_dump(mode="json") for b in game_session._breach_activations
        ]
    return msg


async def _handle_timeout(session_id: str, role: str) -> None:
    """Called when a disconnected client doesn't reconnect within the timeout."""
    from app.main import engine  # local import to avoid circular

    winner_role = "opponent" if role == "player" else "player"
    with Session(engine) as db:
        try:
            sid = uuid.UUID(session_id)
            game_session = db.get(__import__("app.models", fromlist=["GameSession"]).GameSession, sid)
            if game_session and game_session.winner is None:
                game_session.winner = winner_role
                db.add(game_session)
                db.commit()
                db.refresh(game_session)
                await websocket_manager.send_to_role(
                    session_id, winner_role, _build_board_update(game_session)
                )
        except Exception:
            pass


@router.websocket("/{session_id}/ws")
async def websocket_endpoint(
    session_id: uuid.UUID,
    websocket: WebSocket,
    token: str = Query(...),
):
    # --- Authentication ---
    user_id = _decode_ws_token(token)
    if user_id is None:
        await websocket.close(code=4001)
        return

    sid_str = str(session_id)

    # --- Load session from DB ---
    from app.main import engine  # local import to avoid circular
    with Session(engine) as db:
        game_session = db.get(__import__("app.models", fromlist=["GameSession"]).GameSession, session_id)
        if game_session is None:
            await websocket.close(code=4004)
            return

        # --- Determine role ---
        if game_session.player_user_id == user_id:
            role = "player"
        elif game_session.opponent_user_id == user_id:
            role = "opponent"
        else:
            await websocket.close(code=4003)
            return

    # --- Reject if session already has two active connections and this role is taken ---
    active = websocket_manager.get_active_roles(sid_str)
    if role in active:
        # Role already occupied by another live connection
        await websocket.close(code=4003)
        return
    if websocket_manager.is_full(sid_str):
        await websocket.close(code=4003)
        return

    # --- Accept and register ---
    await websocket.accept()
    await websocket_manager.connect(sid_str, role, websocket)

    # Send role_assigned
    await websocket.send_json({"type": "role_assigned", "role": role})

    # Send current board state on (re)connect
    with Session(engine) as db:
        game_session = db.get(__import__("app.models", fromlist=["GameSession"]).GameSession, session_id)
        if game_session:
            await websocket.send_json(_build_board_update(game_session))

    # --- Message loop (tasks 4.3) ---
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "move":
                piece_id_raw = data.get("piece_id")
                to_position = data.get("to_position")

                if piece_id_raw is None or to_position is None:
                    await websocket.send_json({
                        "type": "error",
                        "code": "invalid_message",
                        "detail": "move requires piece_id and to_position",
                    })
                    continue

                with Session(engine) as db:
                    game_session = db.get(
                        __import__("app.models", fromlist=["GameSession"]).GameSession,
                        session_id,
                    )
                    if game_session is None:
                        await websocket.send_json({
                            "type": "error",
                            "code": "session_not_found",
                            "detail": "Session not found",
                        })
                        continue

                    # Validate turn
                    if game_session.current_turn != role:
                        await websocket.send_json({
                            "type": "error",
                            "code": "not_your_turn",
                            "detail": "It is not your turn",
                        })
                        continue

                    # Apply move via session_manager
                    try:
                        move = MoveRequest(
                            piece_id=uuid.UUID(str(piece_id_raw)),
                            to_position=to_position,
                        )
                        updated = session_manager.apply_move(session_id, move, db)
                        board_update = _build_board_update(updated)
                    except Exception as exc:
                        await websocket.send_json({
                            "type": "error",
                            "code": "invalid_move",
                            "detail": str(exc),
                        })
                        continue

                await websocket_manager.broadcast(sid_str, board_update)
                continue

            # Unknown message type
            await websocket.send_json({
                "type": "error",
                "code": "unknown_message_type",
                "detail": f"Unknown message type: {msg_type}",
            })

    except WebSocketDisconnect:
        websocket_manager.disconnect(sid_str, role)
        # Notify the other client
        other_role = "opponent" if role == "player" else "player"
        await websocket_manager.send_to_role(
            sid_str, other_role, {"type": "opponent_disconnected"}
        )
        # Start reconnect timer
        websocket_manager.start_reconnect_timer(
            sid_str, role, RECONNECT_TIMEOUT, _handle_timeout
        )
    except Exception:
        websocket_manager.disconnect(sid_str, role)

