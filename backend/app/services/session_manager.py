"""Session Manager service for CardFlow game sessions."""
import uuid
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session

from app.models import GamePiece, GameSession
from app.schemas import (
    BoardPieceState,
    BreachActivation,
    BreachTarget,
    DifficultyEnum,
    MoveRequest,
    OwnerEnum,
    SessionCreateRequest,
)
from app.utils.damage import calculate_damage


def _build_piece_elements(
    board: list[BoardPieceState], db: Session
) -> dict[uuid.UUID, tuple[str, int]]:
    """Build a piece_id -> (element, base_atk) map for all pieces on the board."""
    result: dict[uuid.UUID, tuple[str, int]] = {}
    for state in board:
        piece = db.get(GamePiece, state.piece_id)
        if piece:
            result[state.piece_id] = (piece.element, piece.base_atk)
    return result

# Board dimensions
BOARD_ROWS = 8
BOARD_COLS = 8

# Initial row ranges
OPPONENT_ROWS = range(0, 3)   # rows 0–2
PLAYER_ROWS = range(5, 8)     # rows 5–7


def _session_to_board_state(session: GameSession) -> list[BoardPieceState]:
    """Deserialise the JSON board_state column into BoardPieceState objects."""
    return [BoardPieceState(**p) for p in session.board_state]


def _board_state_to_dicts(board: list[BoardPieceState]) -> list[dict]:
    """Serialise BoardPieceState objects back to plain dicts for JSON storage."""
    return [p.model_dump(mode="json") for p in board]


def _assign_initial_positions(
    piece_ids: list[uuid.UUID],
    owner: OwnerEnum,
    rows: range,
) -> list[BoardPieceState]:
    """Place pieces in the given row range on dark squares only (checkers convention).

    Dark squares are those where (row + col) % 2 == 1.
    Fills left-to-right, top-to-bottom within the given rows.
    """
    # Build the ordered list of dark squares in the given rows
    # Dark squares: (row + col) % 2 == 0  (top-left corner is dark)
    dark_squares = [
        (r, c)
        for r in rows
        for c in range(BOARD_COLS)
        if (r + c) % 2 == 0
    ]

    states: list[BoardPieceState] = []
    for piece_id, (r, c) in zip(piece_ids, dark_squares):
        states.append(
            BoardPieceState(
                piece_id=piece_id,
                owner=owner,
                position=[r, c],
                current_hp=0,   # will be set after fetching base_hp
                is_evolved=False,
            )
        )
    return states


def create_session(
    request: SessionCreateRequest,
    db: Session,
    user_id: Optional[str] = None,
) -> GameSession:
    """Validate piece IDs, assign initial positions, persist and return a new GameSession."""
    is_remote = request.game_mode.value == "pvp_remote"
    is_pvc = request.game_mode.value == "pvc"

    # For PvC: pick random opponent pieces from the global pool if not provided
    opponent_ids = list(request.opponent_piece_ids)
    if is_pvc and not opponent_ids:
        from sqlmodel import select as sm_select
        import random
        all_pieces = db.exec(sm_select(GamePiece)).all()
        if len(all_pieces) < 12:
            raise HTTPException(status_code=400, detail="Not enough pieces in the system for AI opponent")
        opponent_ids = [p.id for p in random.sample(all_pieces, 12)]

    # For pvp_remote: opponent pieces come at join time — use empty placeholder
    if is_remote:
        opponent_ids = []

    all_ids = list(request.player_piece_ids) + opponent_ids

    # Validate all piece IDs exist and collect base_hp values
    hp_map: dict[uuid.UUID, int] = {}
    for piece_id in all_ids:
        piece = db.get(GamePiece, piece_id)
        if piece is None:
            raise HTTPException(
                status_code=404,
                detail=f"GamePiece {piece_id} not found",
            )
        hp_map[piece_id] = piece.base_hp

    # Assign initial positions
    player_states = _assign_initial_positions(
        request.player_piece_ids, OwnerEnum.player, PLAYER_ROWS
    )
    opponent_states = _assign_initial_positions(
        opponent_ids, OwnerEnum.opponent, OPPONENT_ROWS
    )

    # Set current_hp = base_hp
    for state in player_states + opponent_states:
        state.current_hp = hp_map[state.piece_id]

    board: list[BoardPieceState] = player_states + opponent_states

    # For pvp_remote: status = "waiting", player_user_id from authenticated user
    session_status = "waiting" if is_remote else "local"

    # Derive ai_depth from difficulty when provided (pvc mode)
    _difficulty_depth_map = {
        DifficultyEnum.easy: 1,
        DifficultyEnum.medium: 3,
        DifficultyEnum.hard: 5,
    }
    ai_depth = request.ai_depth
    difficulty_value: Optional[str] = None
    if request.game_mode.value == "pvc" and request.difficulty is not None:
        ai_depth = _difficulty_depth_map[request.difficulty]
        difficulty_value = request.difficulty.value

    session = GameSession(
        game_mode=request.game_mode.value,
        current_turn=OwnerEnum.player.value,
        winner=None,
        board_state=_board_state_to_dicts(board),
        ai_depth=ai_depth,
        status=session_status,
        player_user_id=user_id if is_remote else None,
        difficulty=difficulty_value,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(session_id: uuid.UUID, db: Session) -> GameSession:
    """Fetch a GameSession by ID or raise 404."""
    session = db.get(GameSession, session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail=f"GameSession {session_id} not found",
        )
    return session


def join_session(
    session_id: uuid.UUID,
    user_id: str,
    opponent_piece_ids: list[uuid.UUID],
    db: Session,
) -> GameSession:
    """Register P2 as opponent in a Remote_Session, placing their pieces on the board."""
    session = db.get(GameSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"GameSession {session_id} not found")

    if session.opponent_user_id == user_id:
        return session

    if session.opponent_user_id is not None:
        raise HTTPException(status_code=409, detail="Session already has an opponent")

    if session.player_user_id == user_id:
        raise HTTPException(status_code=400, detail="Player 2 cannot have the same user_id as Player 1")

    # Validate opponent pieces and collect hp
    hp_map: dict[uuid.UUID, int] = {}
    for piece_id in opponent_piece_ids:
        piece = db.get(GamePiece, piece_id)
        if piece is None:
            raise HTTPException(status_code=404, detail=f"GamePiece {piece_id} not found")
        hp_map[piece_id] = piece.base_hp

    # Place opponent pieces on the board (rows 0-2)
    opponent_states = _assign_initial_positions(opponent_piece_ids, OwnerEnum.opponent, OPPONENT_ROWS)
    for state in opponent_states:
        state.current_hp = hp_map[state.piece_id]

    # Merge with existing player pieces (keep player side, replace opponent side)
    existing_board = _session_to_board_state(session)
    player_pieces = [p for p in existing_board if p.owner == OwnerEnum.player]
    new_board = player_pieces + opponent_states

    session.opponent_user_id = user_id
    session.status = "ready"
    session.board_state = _board_state_to_dicts(new_board)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _compute_valid_moves(
    piece_state: BoardPieceState,
    board: list[BoardPieceState],
) -> list[list[int]]:
    """Return legal destination squares for a piece using checkers rules.

    - Normal pieces: forward diagonals only
      - player moves toward lower row numbers (row decreases)
      - opponent moves toward higher row numbers (row increases)
    - Evolved pieces: forward + backward diagonals
    - Jump moves: available when an opponent occupies the intermediate diagonal
      square and the landing square is empty
    """
    row, col = piece_state.position
    owner = piece_state.owner
    is_evolved = piece_state.is_evolved

    # Build position lookup sets
    occupied: dict[tuple[int, int], BoardPieceState] = {
        tuple(p.position): p for p in board  # type: ignore[misc]
    }

    # Direction: player moves "up" (decreasing row), opponent moves "down"
    forward_dir = -1 if owner == OwnerEnum.player else 1
    directions = [forward_dir]
    if is_evolved:
        directions = [forward_dir, -forward_dir]

    moves: list[list[int]] = []

    for dr in directions:
        for dc in (-1, 1):
            nr, nc = row + dr, col + dc
            if not (0 <= nr < BOARD_ROWS and 0 <= nc < BOARD_COLS):
                continue
            target = occupied.get((nr, nc))
            if target is None:
                # Empty square — normal move
                moves.append([nr, nc])
            elif target.owner != owner:
                # Opponent piece — check jump
                jr, jc = nr + dr, nc + dc
                if (
                    0 <= jr < BOARD_ROWS
                    and 0 <= jc < BOARD_COLS
                    and (jr, jc) not in occupied
                ):
                    moves.append([jr, jc])

    return moves


def get_valid_moves(
    session_id: uuid.UUID,
    piece_id: uuid.UUID,
    db: Session,
) -> list[list[int]]:
    """Return legal destinations for a piece in the given session."""
    game_session = get_session(session_id, db)

    # Game finished — no moves
    if game_session.winner is not None:
        return []

    board = _session_to_board_state(game_session)
    piece_state = next(
        (p for p in board if str(p.piece_id) == str(piece_id)), None
    )
    if piece_state is None:
        raise HTTPException(
            status_code=404,
            detail=f"Piece {piece_id} not found on board in session {session_id}",
        )

    return _compute_valid_moves(piece_state, board)


def _get_last_row(owner: OwnerEnum) -> int:
    """Return the row index that triggers evolution for the given owner."""
    # Player pieces evolve when they reach row 0 (opponent's last row)
    # Opponent pieces evolve when they reach row 7 (player's last row)
    return 0 if owner == OwnerEnum.player else BOARD_ROWS - 1


def _apply_breach_aoe(
    evolved_piece: BoardPieceState,
    board: list[BoardPieceState],
    attacker_element: str,
    attacker_base_atk: int,
    db: Session,
) -> tuple[list[BoardPieceState], Optional[BreachActivation]]:
    """When a piece reaches the last row (evolves), it triggers Breach.

    The Breach attack hits all opponent pieces on the four diagonal lines
    emanating from the evolved piece's position. Damage is calculated per
    target using the piece's standard attack (element vs target element).

    Returns (updated_board, breach_activation_info).
    """
    row, col = evolved_piece.position
    owner = evolved_piece.owner

    # All positions on the four diagonal rays from (row, col)
    affected_squares: list[list[int]] = []
    targets_info: list[BreachTarget] = []
    pieces_to_remove: list[uuid.UUID] = []

    # Four diagonal directions
    for dr, dc in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
        r, c = row + dr, col + dc
        while 0 <= r < BOARD_ROWS and 0 <= c < BOARD_COLS:
            affected_squares.append([r, c])
            # Check if there's an opponent piece here
            target = next((p for p in board if p.position == [r, c] and p.owner != owner), None)
            if target is not None:
                target_piece = db.get(GamePiece, target.piece_id)
                if target_piece:
                    damage = calculate_damage(
                        attacker_element,
                        target_piece.element,
                        attacker_base_atk,
                    )
                    new_hp = max(0, int(target.current_hp - damage))
                    target.current_hp = new_hp
                    was_removed = new_hp <= 0
                    if was_removed:
                        pieces_to_remove.append(target.piece_id)
                    targets_info.append(BreachTarget(
                        piece_id=target.piece_id,
                        damage=float(damage),
                        current_hp_after=float(new_hp),
                        was_removed=was_removed,
                    ))
            r += dr
            c += dc

    # Remove defeated pieces
    board = [p for p in board if p.piece_id not in pieces_to_remove]

    if not targets_info:
        return board, None

    breach_info = BreachActivation(
        piece_id=evolved_piece.piece_id,
        element=attacker_element,
        targets=targets_info,
        affected_squares=affected_squares,
    )

    return board, breach_info


def apply_move(
    session_id: uuid.UUID,
    move: MoveRequest,
    db: Session,
) -> GameSession:
    """Validate and apply a move, then persist and return the updated session."""
    game_session = get_session(session_id, db)

    # Game already finished
    if game_session.winner is not None:
        raise HTTPException(
            status_code=400,
            detail="Game is already finished",
        )

    board = _session_to_board_state(game_session)
    current_turn = OwnerEnum(game_session.current_turn)

    # Find the moving piece
    moving_piece: Optional[BoardPieceState] = next(
        (p for p in board if str(p.piece_id) == str(move.piece_id)), None
    )
    if moving_piece is None:
        raise HTTPException(
            status_code=404,
            detail=f"Piece {move.piece_id} not found on board",
        )

    # Validate turn ownership
    if moving_piece.owner != current_turn:
        raise HTTPException(
            status_code=400,
            detail=f"It is not {moving_piece.owner.value}'s turn",
        )

    # Validate move legality
    valid_moves = _compute_valid_moves(moving_piece, board)
    if move.to_position not in valid_moves:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid move to {move.to_position}",
        )

    to_row, to_col = move.to_position
    occupied: dict[tuple[int, int], BoardPieceState] = {
        tuple(p.position): p for p in board  # type: ignore[misc]
    }

    # Determine if this is a jump move (landing square is 2 rows away)
    from_row, from_col = moving_piece.position
    is_jump = abs(to_row - from_row) == 2

    pieces_to_remove: list[uuid.UUID] = []
    breach_activations: list[BreachActivation] = []

    if is_jump:
        # Identify the jumped-over piece
        mid_row = (from_row + to_row) // 2
        mid_col = (from_col + to_col) // 2
        jumped = occupied.get((mid_row, mid_col))
        if jumped is not None and jumped.owner != moving_piece.owner:
            attacker_piece = db.get(GamePiece, moving_piece.piece_id)
            target_piece = db.get(GamePiece, jumped.piece_id)
            if attacker_piece and target_piece:
                damage = calculate_damage(
                    attacker_piece.element,
                    target_piece.element,
                    attacker_piece.base_atk,
                )
                jumped.current_hp = max(0, int(jumped.current_hp - damage))
                if jumped.current_hp <= 0:
                    pieces_to_remove.append(jumped.piece_id)
    else:
        target = occupied.get((to_row, to_col))
        if target is not None and target.owner != moving_piece.owner:
            attacker_piece = db.get(GamePiece, moving_piece.piece_id)
            target_piece = db.get(GamePiece, target.piece_id)
            if attacker_piece and target_piece:
                damage = calculate_damage(
                    attacker_piece.element,
                    target_piece.element,
                    attacker_piece.base_atk,
                )
                target.current_hp = max(0, int(target.current_hp - damage))
                if target.current_hp <= 0:
                    pieces_to_remove.append(target.piece_id)

    # Update moving piece position
    moving_piece.position = [to_row, to_col]

    # Check evolution — trigger Breach AOE if the piece reaches the last row
    if to_row == _get_last_row(moving_piece.owner):
        moving_piece.is_evolved = True
        attacker_piece = db.get(GamePiece, moving_piece.piece_id)
        if attacker_piece:
            board, breach_info = _apply_breach_aoe(
                moving_piece, board,
                attacker_piece.element, attacker_piece.base_atk, db,
    )
            if breach_info is not None:
                breach_activations.append(breach_info)

    # Remove defeated pieces (from non-breach combat)
    board = [p for p in board if p.piece_id not in pieces_to_remove]

    # Advance turn
    next_turn = (
        OwnerEnum.opponent if current_turn == OwnerEnum.player else OwnerEnum.player
    )
    game_session.current_turn = next_turn.value

    # Check win condition
    player_pieces = [p for p in board if p.owner == OwnerEnum.player]
    opponent_pieces = [p for p in board if p.owner == OwnerEnum.opponent]
    if not player_pieces:
        game_session.winner = OwnerEnum.opponent.value
    elif not opponent_pieces:
        game_session.winner = OwnerEnum.player.value



    # --- PvC: apply computer move if game is still ongoing ---
    if (
        game_session.game_mode == "pvc"
        and game_session.winner is None
        and current_turn == OwnerEnum.player
    ):
        # Persist the player's move first
        game_session.board_state = _board_state_to_dicts(board)
        game_session.current_turn = OwnerEnum.opponent.value
        player_breach = breach_activations[:]
        db.add(game_session)
        db.commit()
        db.refresh(game_session)

        from app.services.minimax import best_move as ai_best_move

        piece_elements = _build_piece_elements(board, db)
        ai_move = ai_best_move(game_session, game_session.ai_depth, piece_elements)
        if ai_move is not None:
            try:
                # Apply AI move recursively (current_turn is now "opponent")
                game_session = apply_move(game_session.id, ai_move, db)
            except HTTPException:
                # AI move failed — revert turn to player so the game isn't stuck
                game_session = get_session(game_session.id, db)
                game_session.current_turn = OwnerEnum.player.value
                game_session.board_state = _board_state_to_dicts(board)
                db.add(game_session)
                db.commit()
                db.refresh(game_session)
                game_session._breach_activations = player_breach
                return game_session
            # Re-attach player's breach activations (merged with AI's if any)
            game_session._breach_activations = player_breach + getattr(game_session, '_breach_activations', [])
            return game_session
        else:
            # No moves for AI — pass turn back to player
            game_session = get_session(game_session.id, db)
            game_session.current_turn = OwnerEnum.player.value
            game_session.board_state = _board_state_to_dicts(board)
            db.add(game_session)
            db.commit()
            db.refresh(game_session)
            game_session._breach_activations = player_breach
            return game_session

    # Persist
    game_session.board_state = _board_state_to_dicts(board)
    db.add(game_session)
    db.commit()
    db.refresh(game_session)
    # Attach breach activations AFTER refresh so they survive
    game_session._breach_activations = breach_activations
    return game_session

