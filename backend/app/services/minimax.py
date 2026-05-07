"""Minimax AI engine for CardFlow Battle Checkers.

Uses alpha-beta pruning to select the best move for the computer (opponent) player.
"""
import copy
import uuid
from typing import Optional

from app.models import GameSession
from app.schemas import BoardPieceState, MoveRequest, OwnerEnum
from app.utils.damage import calculate_damage

BOARD_ROWS = 8
BOARD_COLS = 8


# ---------------------------------------------------------------------------
# Board helpers (pure functions — no DB access)
# ---------------------------------------------------------------------------

def _compute_valid_moves_pure(
    piece: BoardPieceState,
    board: list[BoardPieceState],
) -> list[list[int]]:
    """Return legal destination squares for a piece (no DB, no side-effects)."""
    row, col = piece.position
    owner = piece.owner
    occupied: dict[tuple[int, int], BoardPieceState] = {
        tuple(p.position): p for p in board  # type: ignore[misc]
    }

    forward_dir = -1 if owner == OwnerEnum.player else 1
    directions = [forward_dir, -forward_dir] if piece.is_evolved else [forward_dir]

    moves: list[list[int]] = []
    for dr in directions:
        for dc in (-1, 1):
            nr, nc = row + dr, col + dc
            if not (0 <= nr < BOARD_ROWS and 0 <= nc < BOARD_COLS):
                continue
            target = occupied.get((nr, nc))
            if target is None:
                moves.append([nr, nc])
            elif target.owner != owner:
                jr, jc = nr + dr, nc + dc
                if (
                    0 <= jr < BOARD_ROWS
                    and 0 <= jc < BOARD_COLS
                    and (jr, jc) not in occupied
                ):
                    moves.append([jr, jc])
    return moves


def _get_last_row(owner: OwnerEnum) -> int:
    return 0 if owner == OwnerEnum.player else BOARD_ROWS - 1


def _apply_move_pure(
    board: list[BoardPieceState],
    piece_id: uuid.UUID,
    to_position: list[int],
    piece_elements: dict[uuid.UUID, tuple[str, int]],  # piece_id -> (element, base_atk)
) -> list[BoardPieceState]:
    """Apply a move to a board copy and return the new board state."""
    board = copy.deepcopy(board)
    occupied: dict[tuple[int, int], BoardPieceState] = {
        tuple(p.position): p for p in board  # type: ignore[misc]
    }

    moving = next(p for p in board if p.piece_id == piece_id)
    from_row, from_col = moving.position
    to_row, to_col = to_position
    is_jump = abs(to_row - from_row) == 2

    pieces_to_remove: list[uuid.UUID] = []

    if is_jump:
        mid_row = (from_row + to_row) // 2
        mid_col = (from_col + to_col) // 2
        jumped = occupied.get((mid_row, mid_col))
        if jumped and jumped.owner != moving.owner:
            atk_elem, base_atk = piece_elements.get(moving.piece_id, ("Neutral", 1))
            def_elem, _ = piece_elements.get(jumped.piece_id, ("Neutral", 1))
            damage = calculate_damage(atk_elem, def_elem, base_atk)
            jumped.current_hp = max(0, int(jumped.current_hp - damage))
            if jumped.current_hp <= 0:
                pieces_to_remove.append(jumped.piece_id)
    else:
        target = occupied.get((to_row, to_col))
        if target and target.owner != moving.owner:
            atk_elem, base_atk = piece_elements.get(moving.piece_id, ("Neutral", 1))
            def_elem, _ = piece_elements.get(target.piece_id, ("Neutral", 1))
            damage = calculate_damage(atk_elem, def_elem, base_atk)
            target.current_hp = max(0, int(target.current_hp - damage))
            if target.current_hp <= 0:
                pieces_to_remove.append(target.piece_id)

    moving.position = [to_row, to_col]
    if to_row == _get_last_row(moving.owner):
        moving.is_evolved = True

    board = [p for p in board if p.piece_id not in pieces_to_remove]
    return board


def _all_moves_for_owner(
    board: list[BoardPieceState],
    owner: OwnerEnum,
) -> list[tuple[uuid.UUID, list[int]]]:
    """Return all (piece_id, to_position) pairs for the given owner."""
    result: list[tuple[uuid.UUID, list[int]]] = []
    for piece in board:
        if piece.owner == owner:
            for dest in _compute_valid_moves_pure(piece, board):
                result.append((piece.piece_id, dest))
    return result


# ---------------------------------------------------------------------------
# Heuristic evaluation
# ---------------------------------------------------------------------------

def evaluate(board_state: list[BoardPieceState]) -> float:
    """Heuristic score from the opponent (maximising) perspective.

    score = (opponent_piece_count * 10 + opponent_hp_total + opponent_advancement)
          - (player_piece_count   * 10 + player_hp_total   + player_advancement)

    Advancement = sum of row progress toward the opponent's last row.
    - Player pieces advance toward row 0  → advancement = (BOARD_ROWS - 1 - row)
    - Opponent pieces advance toward row 7 → advancement = row
    """
    player_count = 0
    player_hp = 0
    player_adv = 0
    opponent_count = 0
    opponent_hp = 0
    opponent_adv = 0

    for piece in board_state:
        row = piece.position[0]
        if piece.owner == OwnerEnum.player:
            player_count += 1
            player_hp += piece.current_hp
            player_adv += (BOARD_ROWS - 1 - row)  # progress toward row 0
        else:
            opponent_count += 1
            opponent_hp += piece.current_hp
            opponent_adv += row  # progress toward row 7

    return (
        (opponent_count * 10 + opponent_hp + opponent_adv)
        - (player_count * 10 + player_hp + player_adv)
    )


# ---------------------------------------------------------------------------
# Alpha-beta Minimax
# ---------------------------------------------------------------------------

def minimax(
    board: list[BoardPieceState],
    depth: int,
    alpha: float,
    beta: float,
    maximizing: bool,
    piece_elements: dict[uuid.UUID, tuple[str, int]],
) -> tuple[float, Optional[tuple[uuid.UUID, list[int]]]]:
    """Recursive alpha-beta Minimax.

    Returns (score, best_move) where best_move is (piece_id, to_position) or None.
    Maximising player = opponent; minimising player = player.
    """
    player_pieces = [p for p in board if p.owner == OwnerEnum.player]
    opponent_pieces = [p for p in board if p.owner == OwnerEnum.opponent]

    # Terminal: one side wiped out
    if not player_pieces:
        return (1000.0 + depth, None)   # opponent wins — prefer faster wins
    if not opponent_pieces:
        return (-1000.0 - depth, None)  # player wins

    if depth == 0:
        return (evaluate(board), None)

    current_owner = OwnerEnum.opponent if maximizing else OwnerEnum.player
    moves = _all_moves_for_owner(board, current_owner)

    if not moves:
        # No moves available — treat as pass
        return (evaluate(board), None)

    best_move: Optional[tuple[uuid.UUID, list[int]]] = None

    if maximizing:
        best_score = float("-inf")
        for piece_id, dest in moves:
            new_board = _apply_move_pure(board, piece_id, dest, piece_elements)
            score, _ = minimax(new_board, depth - 1, alpha, beta, False, piece_elements)
            if score > best_score:
                best_score = score
                best_move = (piece_id, dest)
            alpha = max(alpha, best_score)
            if beta <= alpha:
                break
        return (best_score, best_move)
    else:
        best_score = float("inf")
        for piece_id, dest in moves:
            new_board = _apply_move_pure(board, piece_id, dest, piece_elements)
            score, _ = minimax(new_board, depth - 1, alpha, beta, True, piece_elements)
            if score < best_score:
                best_score = score
                best_move = (piece_id, dest)
            beta = min(beta, best_score)
            if beta <= alpha:
                break
        return (best_score, best_move)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def best_move(
    session: GameSession,
    depth: int,
    piece_elements: dict[uuid.UUID, tuple[str, int]],
) -> Optional[MoveRequest]:
    """Return the best MoveRequest for the computer (opponent) player, or None.

    Args:
        session: The current GameSession ORM object.
        depth: Minimax look-ahead depth.
        piece_elements: Mapping of piece_id -> (element, base_atk) for damage calc.

    Returns:
        A MoveRequest if a move is available, otherwise None.
    """
    board = [BoardPieceState(**p) for p in session.board_state]
    _, move = minimax(board, depth, float("-inf"), float("inf"), True, piece_elements)
    if move is None:
        return None
    piece_id, to_position = move
    return MoveRequest(piece_id=piece_id, to_position=to_position)
