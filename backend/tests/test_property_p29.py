# Feature: cardflow-platform, Property 29: Minimax AI always returns a valid move or None

import uuid
from typing import Optional

from hypothesis import given, settings
from hypothesis import strategies as st

from app.schemas import BoardPieceState, MoveRequest, OwnerEnum
from app.services.minimax import (
    _compute_valid_moves_pure,
    _all_moves_for_owner,
    best_move,
)
from app.models import GameSession


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


def _unique_positions(n: int, draw):
    """Draw n distinct [row, col] positions from the 8x8 board."""
    positions = draw(
        st.lists(
            st.tuples(st.integers(0, 7), st.integers(0, 7)),
            min_size=n,
            max_size=n,
            unique=True,
        )
    )
    return [[r, c] for r, c in positions]


@st.composite
def board_state_strategy(draw):
    """Generate a random board with 1–4 player pieces and 1–4 opponent pieces."""
    n_player = draw(st.integers(1, 4))
    n_opponent = draw(st.integers(1, 4))
    total = n_player + n_opponent
    positions = _unique_positions(total, draw)

    pieces: list[BoardPieceState] = []
    for i in range(n_player):
        pieces.append(
            BoardPieceState(
                piece_id=uuid.uuid4(),
                owner=OwnerEnum.player,
                position=positions[i],
                current_hp=draw(st.integers(1, 50)),
                is_evolved=draw(st.booleans()),
            )
        )
    for i in range(n_opponent):
        pieces.append(
            BoardPieceState(
                piece_id=uuid.uuid4(),
                owner=OwnerEnum.opponent,
                position=positions[n_player + i],
                current_hp=draw(st.integers(1, 50)),
                is_evolved=draw(st.booleans()),
            )
        )
    return pieces


def _make_session(board: list[BoardPieceState]) -> GameSession:
    """Build a minimal GameSession object (no DB) for testing best_move."""
    return GameSession(
        id=uuid.uuid4(),
        game_mode="pvc",
        current_turn="opponent",
        winner=None,
        board_state=[p.model_dump(mode="json") for p in board],
        ai_depth=2,  # shallow depth for fast tests
    )


def _make_piece_elements(board: list[BoardPieceState]) -> dict[uuid.UUID, tuple[str, int]]:
    """Assign random-but-deterministic element/base_atk to each piece."""
    return {
        p.piece_id: (ELEMENTS[hash(str(p.piece_id)) % len(ELEMENTS)], 10)
        for p in board
    }


# ---------------------------------------------------------------------------
# Property 29
# ---------------------------------------------------------------------------

@given(board=board_state_strategy())
@settings(max_examples=20, deadline=None)
def test_minimax_returns_valid_move_or_none(board):
    """
    **Validates: Requirements 19.1, 19.5**

    For any board state where the computer (opponent) has pieces, best_move
    should return either:
    - A MoveRequest whose to_position is in the valid moves list for the
      selected piece, OR
    - None when no moves are available for the opponent.
    """
    session = _make_session(board)
    piece_elements = _make_piece_elements(board)

    result: Optional[MoveRequest] = best_move(session, depth=2, piece_elements=piece_elements)

    available_moves = _all_moves_for_owner(board, OwnerEnum.opponent)

    if not available_moves:
        # No moves available — must return None
        assert result is None, (
            f"Expected None when no moves available, got {result}"
        )
    else:
        # Must return a valid move
        assert result is not None, (
            "Expected a MoveRequest when moves are available, got None"
        )
        assert isinstance(result, MoveRequest), (
            f"Expected MoveRequest, got {type(result)}"
        )

        # The selected piece must exist on the board as an opponent piece
        piece_state = next(
            (p for p in board if p.piece_id == result.piece_id), None
        )
        assert piece_state is not None, (
            f"Returned piece_id {result.piece_id} not found on board"
        )
        assert piece_state.owner == OwnerEnum.opponent, (
            f"Returned piece belongs to {piece_state.owner}, expected opponent"
        )

        # The destination must be in the valid moves for that piece
        valid = _compute_valid_moves_pure(piece_state, board)
        assert result.to_position in valid, (
            f"Returned to_position {result.to_position} not in valid moves {valid} "
            f"for piece at {piece_state.position} (evolved={piece_state.is_evolved})"
        )
