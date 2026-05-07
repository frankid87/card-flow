# Feature: cardflow-platform, Property 25: Attack damage applied correctly server-side

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
from app.utils.damage import calculate_damage

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

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


def _make_db_piece(db: Session, element: str, base_hp: int, base_atk: int) -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(
        artwork_id=artwork.id,
        name="P",
        element=element,
        base_hp=base_hp,
        base_atk=base_atk,
    )
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


# ---------------------------------------------------------------------------
# Property 25
# ---------------------------------------------------------------------------

@given(
    atk_element=st.sampled_from(ELEMENTS),
    def_element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=20),
    target_hp=st.integers(min_value=1, max_value=100),
)
@settings(max_examples=20, deadline=None)
def test_attack_damage_applied_correctly(atk_element, def_element, base_atk, target_hp):
    """
    **Validates: Requirements 17.6, 17.7**

    After a jump-attack move, the target's current_hp must equal
    max(0, target_hp - calculate_damage(atk_element, def_element, base_atk)).
    The target must be absent from board_state iff resulting HP <= 0.

    In this implementation, attacks are resolved via jump moves: the player
    piece jumps over the opponent piece (which is on the intermediate diagonal
    square) and lands on the empty square beyond it.
    """
    # Player at row 4, col 3
    # Opponent at row 3, col 4 (intermediate diagonal)
    # Landing square at row 2, col 5 (must be empty)
    player_row, player_col = 4, 3
    opp_row, opp_col = 3, 4
    land_row, land_col = 2, 5

    with Session(test_engine) as db:
        player_db_id = _make_db_piece(db, atk_element, base_hp=50, base_atk=base_atk)
        opp_db_id = _make_db_piece(db, def_element, base_hp=target_hp, base_atk=5)

    board = [
        BoardPieceState(
            piece_id=player_db_id,
            owner=OwnerEnum.player,
            position=[player_row, player_col],
            current_hp=50,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_db_id,
            owner=OwnerEnum.opponent,
            position=[opp_row, opp_col],
            current_hp=target_hp,
            is_evolved=False,
        ),
    ]

    with Session(test_engine) as db:
        gs = GameSession(
            game_mode="pvp",
            current_turn="player",
            winner=None,
            board_state=[p.model_dump(mode="json") for p in board],
            ai_depth=3,
        )
        db.add(gs)
        db.commit()
        db.refresh(gs)
        session_id = gs.id

    # Jump move: player at [4,3] jumps over opponent at [3,4] to land at [2,5]
    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(player_db_id), "to_position": [land_row, land_col]},
    )
    assert response.status_code == 200, response.text

    data = response.json()
    new_board = data["board_state"]

    expected_damage = calculate_damage(atk_element, def_element, base_atk)
    expected_hp = max(0, int(target_hp - expected_damage))

    target_in_response = next(
        (p for p in new_board if p["piece_id"] == str(opp_db_id)), None
    )

    if expected_hp <= 0:
        assert target_in_response is None, (
            f"Target should be removed (HP={expected_hp}) but is still on board"
        )
    else:
        assert target_in_response is not None, (
            f"Target should survive (HP={expected_hp}) but was removed"
        )
        assert target_in_response["current_hp"] == expected_hp, (
            f"Expected HP={expected_hp}, got {target_in_response['current_hp']}"
        )
