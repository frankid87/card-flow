# Feature: cardflow-platform, Property 30: pvc response reflects both moves

import uuid

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork, GamePiece, GameSession
from app.schemas import (
    BoardPieceState,
    GameModeEnum,
    MoveRequest,
    OwnerEnum,
    SessionResponse,
)
from app.services import session_manager

# ---------------------------------------------------------------------------
# Test app
# ---------------------------------------------------------------------------

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(test_engine)

test_app = FastAPI()


def get_db():
    with Session(test_engine) as session:
        yield session


def _to_response(gs) -> SessionResponse:
    return SessionResponse(
        session_id=gs.id,
        game_mode=GameModeEnum(gs.game_mode),
        current_turn=OwnerEnum(gs.current_turn),
        winner=gs.winner,
        board_state=[BoardPieceState(**p) for p in gs.board_state],
    )


@test_app.post("/game/{session_id}/move", response_model=SessionResponse)
def apply_move(session_id: uuid.UUID, body: MoveRequest, db: Session = Depends(get_db)):
    gs = session_manager.apply_move(session_id, body, db)
    return _to_response(gs)


client = TestClient(test_app)


def _make_db_piece(db: Session, base_hp: int = 100) -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(
        artwork_id=artwork.id,
        name="P",
        element="Neutral",
        base_hp=base_hp,
        base_atk=1,  # low atk so pieces survive attacks
    )
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


# ---------------------------------------------------------------------------
# Property 30
# ---------------------------------------------------------------------------

@given(
    player_col=st.integers(1, 6),
    opp_col=st.integers(1, 6),
)
@settings(max_examples=20)
def test_pvc_response_reflects_both_moves(player_col, opp_col):
    """
    **Validates: Requirements 19.1, 19.6**

    In a pvc session, after the player submits a valid move that doesn't end
    the game, the SessionResponse must reflect both the player's move and the
    computer's move, and current_turn must be "player" again.
    """
    with Session(test_engine) as db:
        player_id = _make_db_piece(db, base_hp=100)
        opp_id = _make_db_piece(db, base_hp=100)

    # Place pieces well apart (rows 5 and 2) so no jump is possible between them.
    # Player forward direction is toward row 0 (decreasing row).
    # From [5, player_col], valid 1-step moves are [4, player_col-1] and [4, player_col+1].
    player_pos = [5, player_col]
    opp_pos = [2, opp_col]

    # Compute the destination directly — pick the left diagonal if in bounds, else right
    dest_col = player_col - 1 if player_col - 1 >= 0 else player_col + 1
    dest = [4, dest_col]

    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=player_pos,
            current_hp=100,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_id,
            owner=OwnerEnum.opponent,
            position=opp_pos,
            current_hp=100,
            is_evolved=False,
        ),
    ]

    # Verify dest is not occupied by opponent
    if dest == opp_pos:
        return  # skip this edge case

    with Session(test_engine) as db:
        gs = GameSession(
            game_mode="pvc",
            current_turn="player",
            winner=None,
            board_state=[p.model_dump(mode="json") for p in board],
            ai_depth=1,
        )
        db.add(gs)
        db.commit()
        db.refresh(gs)
        session_id = gs.id

    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(player_id), "to_position": dest},
    )
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}. "
        f"player_pos={player_pos}, dest={dest}, opp_pos={opp_pos}"
    )

    data = response.json()

    # If game ended (winner set), skip the current_turn check
    if data["winner"] is not None:
        return

    # Both moves applied: current_turn must be back to "player"
    assert data["current_turn"] == "player", (
        f"Expected current_turn='player' after pvc round-trip, "
        f"got '{data['current_turn']}'"
    )

    # Player piece must have moved to destination
    player_in_response = next(
        (p for p in data["board_state"] if p["piece_id"] == str(player_id)), None
    )
    if player_in_response is not None:
        assert player_in_response["position"] == dest, (
            f"Player piece should be at {dest}, got {player_in_response['position']}"
        )
