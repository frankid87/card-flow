# Implementation Plan: CardFlow Platform (Battle Checkers Edition)

## Overview

Incremental implementation of the CardFlow monorepo: backend (FastAPI + PostgreSQL) first, then frontend (Next.js 14). Each task builds on the previous, ending with full integration. All correctness properties from the design are covered by property-based tests placed close to the relevant implementation task.

## Tasks

- [x] 1. Set up monorepo structure and backend scaffolding
  - Create `/backend` and `/frontend` directory layout
  - Initialize `backend/app/main.py` with a bare FastAPI app that reads `DATABASE_URL` from env and raises `RuntimeError` if absent
  - Add `backend/requirements.txt` with `fastapi`, `uvicorn`, `sqlmodel`, `psycopg2-binary`, `pydantic`, `gunicorn`, `hypothesis`, `pytest`, `httpx`
  - Create `backend/Dockerfile` using Python 3.11+ base, installing from `requirements.txt`, running Gunicorn+Uvicorn workers, binding to `$PORT` (default 8000)
  - Create `docker-compose.yml` at monorepo root with `backend` and `postgres` services linked via `DATABASE_URL`
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 14.1, 14.4_

- [x] 2. Implement ORM models and database schema
  - [x] 2.1 Create `backend/app/models.py` with `Artwork`, `GamePiece`, and `GameState` SQLModel table classes
    - Use UUID primary keys with `default_factory=uuid.uuid4`
    - `GamePiece.artwork_id` FK to `artworks.id` with `ON DELETE RESTRICT`
    - `GameState.piece_id` FK to `game_pieces.id` with `ON DELETE RESTRICT`
    - `GameState.is_evolved` defaults to `False`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.4_

  - [x] 2.2 Write property test for artwork deletion blocked when referenced (P7)
    - `# Feature: cardflow-platform, Property 7: Artwork deletion blocked when referenced`
    - Generate artwork + GamePiece referencing it; attempt DELETE on artwork; assert FK constraint error and artwork still exists
    - _Requirements: 1.4_

  - [x] 2.3 Write property test for GamePiece deletion blocked when game_state references it (P8)
    - `# Feature: cardflow-platform, Property 8: GamePiece deletion blocked when game_state references it`
    - Create GamePiece + GameState referencing it; attempt DELETE on piece; assert FK constraint error and piece still exists
    - _Requirements: 3.4_

- [x] 3. Implement Pydantic schemas
  - [x] 3.1 Create `backend/app/schemas.py` with all six schema classes
    - `ArtworkCreate`: `image_url` non-empty via `@field_validator`, optional `prompt` and `seed`
    - `ArtworkResponse`: all artwork fields including `id` and `created_at`
    - `GamePieceCreate`: `artwork_id`, `name`, `element` (ElementEnum), `base_hp` (`gt=0`), `base_atk` (`gt=0`)
    - `GamePieceResponse`: extends `GamePieceCreate` with `id` and nested `ArtworkResponse`
    - `GameStateCreate`: `piece_id`, `current_hp` (`ge=0`), `is_evolved` (default `False`)
    - `GameStateResponse`: extends `GameStateCreate` with `id`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.2 Write property test for invalid request bodies return 422 (P9)
    - `# Feature: cardflow-platform, Property 9: Invalid request bodies return 422`
    - Generate bodies missing required fields, wrong types, and invalid element enum values; assert HTTP 422 with JSON validation error
    - _Requirements: 5.7, 5.8, 5.9_

- [x] 4. Implement damage utility
  - [x] 4.1 Create `backend/app/utils/damage.py` with `ELEMENTAL_MATRIX` dict and `calculate_damage` function
    - Encode all 12 directional element pairs per the spec; default to `1.0` for any pair not in the dict
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.2 Write property test for Elemental Matrix correctness (P13)
    - `# Feature: cardflow-platform, Property 13: Elemental Matrix correctness`
    - For each element pair in `ELEMENTAL_MATRIX`, generate random positive `base_atk`; assert `calculate_damage` returns `base_atk * expected_multiplier`; also assert same-element and Neutral pairs return `1x`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.3 Write property test for calculate_damage always positive (P14)
    - `# Feature: cardflow-platform, Property 14: calculate_damage always returns a positive value`
    - Generate random element pairs and positive `base_atk`; assert `calculate_damage > 0`
    - _Requirements: 4.5_

- [x] 5. Implement global error handler
  - [x] 5.1 Register `HTTPException` and unhandled `Exception` handlers in `backend/app/main.py`
    - `HTTPException` handler: return `JSONResponse` with `exc.status_code` and `{"detail": exc.detail}`
    - Unhandled handler: return `JSONResponse` with status 500 and `{"detail": "Internal server error", "type": type(exc).__name__}`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 5.2 Write property test for unhandled exceptions return 500 JSON (P10)
    - `# Feature: cardflow-platform, Property 10: Unhandled exceptions return 500 JSON`
    - Trigger unhandled exception in a test route; assert HTTP 500 with JSON body containing `detail` and `type`
    - _Requirements: 8.2_

  - [x] 5.3 Write property test for HTTP exceptions return correct status code with JSON (P11)
    - `# Feature: cardflow-platform, Property 11: HTTP exceptions return correct status code with JSON`
    - Raise `HTTPException` with random 4xx/5xx codes; assert response status matches and body contains `detail`
    - _Requirements: 8.3_

- [-] 6. Implement artworks router
  - [x] 6.1 Create `backend/app/routers/artworks.py` with `POST /artworks` and `GET /artworks` endpoints
    - `POST /artworks`: validate via `ArtworkCreate`, persist `Artwork`, return `ArtworkResponse` with HTTP 201
    - `GET /artworks`: return `list[ArtworkResponse]` with HTTP 200
    - Mount router on main FastAPI app
    - _Requirements: 6.1, 6.2, 6.3, 14.2_

  - [x] 6.2 Write property test for artwork creation round-trip (P1)
    - `# Feature: cardflow-platform, Property 1: Artwork creation round-trip`
    - Generate random valid `ArtworkCreate` payloads; POST and assert response fields match input with HTTP 201
    - _Requirements: 6.1_

  - [x] 6.3 Write property test for artwork list completeness (P2)
    - `# Feature: cardflow-platform, Property 2: Artwork list completeness`
    - POST N random artworks; GET `/artworks`; assert all IDs present in response
    - _Requirements: 6.2_

- [x] 7. Implement pieces router
  - [x] 7.1 Create `backend/app/routers/pieces.py` with `POST /pieces` and `GET /pieces` endpoints
    - `POST /pieces`: validate via `GamePieceCreate`; check artwork existence (404 if not found); persist `GamePiece`; return `GamePieceResponse` with joined artwork, HTTP 201
    - `GET /pieces`: return `list[GamePieceResponse]` with joined artwork data, HTTP 200
    - Mount router on main FastAPI app
    - _Requirements: 7.1, 7.2, 7.3, 14.2_

  - [x] 7.2 Write property test for game piece creation round-trip (P3)
    - `# Feature: cardflow-platform, Property 3: Game piece creation round-trip`
    - Generate random valid `GamePieceCreate` with existing artwork; POST and assert all fields match with HTTP 201 and joined artwork populated
    - _Requirements: 7.1_

  - [x] 7.3 Write property test for game piece list completeness with joined artwork (P4)
    - `# Feature: cardflow-platform, Property 4: Game piece list completeness with joined artwork`
    - POST N pieces; GET `/pieces`; assert all IDs present and each has artwork fields populated
    - _Requirements: 7.3_

  - [x] 7.4 Write property test for non-existent artwork_id returns 404 (P5)
    - `# Feature: cardflow-platform, Property 5: Non-existent artwork_id returns 404`
    - Generate random UUIDs not in DB; POST `/pieces`; assert HTTP 404 with JSON error body
    - _Requirements: 7.2_

  - [x] 7.5 Write property test for multiple game pieces sharing an artwork (P6)
    - `# Feature: cardflow-platform, Property 6: Multiple game pieces can share an artwork`
    - Create one artwork; POST N `GamePiece` records referencing same `artwork_id`; assert no constraint errors
    - _Requirements: 2.4_

  - [x] 7.6 Write property test for artwork record unchanged after game piece creation (P12)
    - `# Feature: cardflow-platform, Property 12: Artwork record unchanged after game piece creation`
    - Fetch artwork fields before and after creating a GamePiece referencing it; assert fields are identical
    - _Requirements: 13.2_

- [x] 8. Backend checkpoint — Ensure all tests pass
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 9. Initialize Next.js 14 frontend
  - Scaffold `/frontend` with Next.js 14 App Router, Tailwind CSS, and TypeScript
  - Add `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `fast-check`, and `jsdom` as dev dependencies
  - Create shared TypeScript types in `frontend/types/index.ts` mirroring `ArtworkResponse`, `GamePieceResponse`, and `GameState`
  - _Requirements: 14.1, 14.3_

- [x] 10. Implement overlay components
  - [x] 10.1 Create `frontend/components/HP_Bar.tsx`
    - Accept `{ current_hp: number; base_hp: number }` props
    - Render current HP value and a proportional bar
    - _Requirements: 10.3_

  - [x] 10.2 Create `frontend/components/Element_Icon.tsx`
    - Accept `{ element: string }` prop
    - Render element name or icon badge for each of the 7 elements
    - _Requirements: 10.4_

  - [x] 10.3 Create `frontend/components/Evolved_Crown.tsx`
    - Render a crown/star icon; component is only mounted when `is_evolved` is true (caller controls mounting)
    - _Requirements: 10.5, 10.6_

- [x] 11. Implement PieceRenderer component
  - [x] 11.1 Create `frontend/components/PieceRenderer.tsx`
    - Accept `{ data: GamePieceResponse; state: { current_hp: number; is_evolved: boolean } }` props
    - Render `data.artwork.image_url` as a circular element with `rounded-full` and `object-cover`; fall back to static placeholder if `image_url` absent
    - Render `HP_Bar`, `Element_Icon` as absolutely-positioned overlays
    - Conditionally render `Evolved_Crown` when `state.is_evolved` is true
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 13.3_

  - [x] 11.2 Write property test for PieceRenderer renders correct overlays (P15)
    - `// Feature: cardflow-platform, Property 15: PieceRenderer renders circular token with correct overlays`
    - Generate random `GamePieceResponse` + `GameState`; render `PieceRenderer`; assert `rounded-full`, `object-cover`, HP_Bar shows `current_hp`, Element_Icon shows element, Evolved_Crown present iff `is_evolved=true`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 12. Implement Board component
  - [x] 12.1 Create `frontend/components/Board.tsx`
    - Render 8×8 grid of alternating light/dark squares via Tailwind CSS
    - Place each active piece on its square using `PieceRenderer`
    - On piece selection, compute valid diagonal moves: forward only for normal pieces, forward + backward for evolved pieces
    - On move to occupied opponent square, invoke `calculate_damage` and update `current_hp`; remove piece if `current_hp <= 0`
    - Set `is_evolved = true` when a piece reaches the opponent's last row
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 12.2 Write property test for Board movement highlights correct diagonal squares (P16)
    - `// Feature: cardflow-platform, Property 16: Board movement highlights correct diagonal squares`
    - Generate random piece positions and evolved status; render Board with selection; assert highlighted squares are exactly the correct diagonals
    - _Requirements: 11.3, 11.4_

  - [x] 12.3 Write property test for attack reduces target HP by calculate_damage result (P17)
    - `// Feature: cardflow-platform, Property 17: Attack reduces target HP by calculate_damage result`
    - Generate random attacker/target element pairs and `base_atk`; simulate board attack; assert target `current_hp` reduced by `calculate_damage` result
    - _Requirements: 11.6, 11.7_

  - [x] 12.4 Write property test for piece removal and survival based on HP after attack (P18)
    - `// Feature: cardflow-platform, Property 18: Piece removal and survival based on HP after attack`
    - Generate attacks where resulting HP ≤ 0; assert target removed; generate attacks where resulting HP > 0; assert target remains with updated HP
    - _Requirements: 11.8, 11.9_

  - [x] 12.5 Write property test for evolution triggered on reaching opponent's last row (P19)
    - `// Feature: cardflow-platform, Property 19: Evolution triggered on reaching opponent's last row`
    - Generate piece positions adjacent to opponent's last row; simulate move to last row; assert `is_evolved=true`
    - _Requirements: 11.10_

- [x] 13. Implement Dashboard page
  - [x] 13.1 Create `frontend/app/page.tsx` as the Dashboard
    - Fetch all artworks from `GET /artworks` on mount; render each as a selectable thumbnail
    - On artwork selection, show piece creation form pre-populated with `artwork_id` and fields for `name`, `element`, `base_hp`, `base_atk`
    - On form submit, POST to `/pieces`; render result via `PieceRenderer`; disable submit button during in-flight request
    - On any API error, display error message without crashing
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.3_

  - [ ] 13.2 Write property test for API failure shows error without crash (P20)
    - `// Feature: cardflow-platform, Property 20: API failure shows error without crash`
    - Mock API error responses; simulate form submission; assert error message is visible and page remains interactive
    - _Requirements: 12.4_

  - [ ]* 13.3 Write property test for submit button disabled during in-flight request (P21)
    - `// Feature: cardflow-platform, Property 21: Submit button disabled during in-flight request`
    - Simulate form submission in progress; assert submit button is disabled until request completes
    - _Requirements: 12.5_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all backend and frontend tests pass, ask the user if questions arise.

- [ ] 15. Implement game session schemas
  - [x] 15.1 Extend `backend/app/schemas.py` with session-related schemas
    - Add `GameModeEnum` (`pvp`, `pvc`) and `OwnerEnum` (`player`, `opponent`)
    - Add `BoardPieceState`: `piece_id`, `owner`, `position` (list[int]), `current_hp`, `is_evolved`
    - Add `SessionCreateRequest`: `player_piece_ids`, `opponent_piece_ids`, `game_mode`, `ai_depth` (default 3, gt=0)
    - Add `SessionResponse`: `session_id`, `game_mode`, `current_turn`, `winner` (nullable), `board_state`
    - Add `MoveRequest`: `piece_id`, `to_position` (list[int])
    - Add `ValidMovesResponse`: `piece_id`, `moves` (list[list[int]])
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

- [x] 16. Implement game session ORM model
  - [x] 16.1 Add `GameSession` SQLModel table class to `backend/app/models.py`
    - Columns: `id` (UUID PK), `game_mode` (VARCHAR), `current_turn` (VARCHAR), `winner` (nullable VARCHAR), `board_state` (JSON column storing list of `BoardPieceState` dicts), `ai_depth` (INTEGER, default 3), `created_at` (TIMESTAMPTZ)
    - _Requirements: 15.1, 16.3_

- [x] 17. Implement Session Manager service
  - [x] 17.1 Create `backend/app/services/__init__.py` (empty)
  - [x] 17.2 Create `backend/app/services/session_manager.py`
    - `create_session(request, db)`: validate all piece IDs exist (404 if not), assign initial positions (player rows 5–7, opponent rows 0–2), set `current_hp = base_hp`, `is_evolved = False`, persist `GameSession`, return it
    - `get_session(session_id, db)`: fetch session or raise 404
    - `get_valid_moves(session_id, piece_id, db)`: compute legal destinations using checkers rules (forward diagonals; forward+backward if evolved; jump if opponent in path and landing square empty); return empty list if game finished
    - `apply_move(session_id, move, db)`: validate turn ownership (400 if wrong turn), validate move legality (400 if invalid), apply move (update position, resolve attack with `calculate_damage`, remove piece if HP ≤ 0, set `is_evolved` if last row reached), advance `current_turn`, check win condition, persist, return updated session
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 16.1, 16.2, 16.3, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 18. Implement Minimax AI
  - [x] 18.1 Create `backend/app/services/minimax.py`
    - `evaluate(board_state)`: heuristic = `(player_piece_count * 10 + player_hp_total + player_advancement) - (opponent_piece_count * 10 + opponent_hp_total + opponent_advancement)`; advancement = sum of row progress toward opponent's last row
    - `minimax(board_state, depth, alpha, beta, maximizing)`: recursive alpha-beta Minimax; returns (score, best_move)
    - `best_move(session, depth)`: entry point; returns `MoveRequest` for the best computer move, or `None` if no moves available
    - _Requirements: 19.2, 19.3, 19.4, 19.5_

  - [x] 18.2 Integrate Minimax into `apply_move` in Session Manager
    - After applying the player's move in `pvc` mode, if game is not finished, call `best_move(session, session.ai_depth)` and apply the result (or pass if `None`)
    - _Requirements: 19.1, 19.5, 19.6_

  - [x] 18.3 Write property test for Minimax always returns valid move or None (P29)
    - `# Feature: cardflow-platform, Property 29: Minimax AI always returns a valid move or None`
    - Generate board states with computer pieces; call `best_move`; assert returned move is in valid moves list or None when no moves exist
    - _Requirements: 19.1, 19.5_

- [x] 19. Implement game router
  - [x] 19.1 Create `backend/app/routers/game.py` with all four game endpoints
    - `POST /game/session` → `SessionCreateRequest` → `SessionResponse` (201)
    - `GET /game/{session_id}` → `SessionResponse` (200)
    - `POST /game/{session_id}/move` → `MoveRequest` → `SessionResponse` (200)
    - `GET /game/{session_id}/valid-moves/{piece_id}` → `ValidMovesResponse` (200)
    - Mount router on main FastAPI app with JWT auth dependency
    - _Requirements: 15.1, 16.1, 17.1, 18.1_

  - [x] 19.2 Write property test for session creation round-trip (P22)
    - `# Feature: cardflow-platform, Property 22: Session creation round-trip`
    - Generate valid `SessionCreateRequest` with existing pieces; POST `/game/session`; assert `board_state` contains all pieces with correct initial HP, `is_evolved=false`, positions in correct rows
    - _Requirements: 15.1, 15.2, 15.4_

  - [x] 19.3 Write property test for valid moves consistency (P23)
    - `# Feature: cardflow-platform, Property 23: Valid moves consistency — server matches checkers rules`
    - For random board states, call `GET /game/{id}/valid-moves/{pid}`; assert returned moves match checkers rules
    - _Requirements: 18.1, 18.4_

  - [x] 19.4 Write property test for move application preserves board invariants (P24)
    - `# Feature: cardflow-platform, Property 24: Move application preserves board invariants`
    - Apply random valid moves; assert no two pieces share a position, moved piece is at destination, piece count invariant holds, `current_turn` switched
    - _Requirements: 17.1, 17.5, 17.6, 17.8_

  - [x] 19.5 Write property test for attack damage applied correctly server-side (P25)
    - `# Feature: cardflow-platform, Property 25: Attack damage applied correctly server-side`
    - Apply random attack moves; assert target HP reduced by `calculate_damage` result; assert target absent iff resulting HP ≤ 0
    - _Requirements: 17.6, 17.7_

  - [x] 19.6 Write property test for evolution triggered server-side on last row (P26)
    - `# Feature: cardflow-platform, Property 26: Evolution triggered server-side on last row`
    - Move player piece to row 0 or opponent piece to row 7; assert `is_evolved=true` in response
    - _Requirements: 17.7_

  - [x] 19.7 Write property test for invalid move rejected with 400 (P27)
    - `# Feature: cardflow-platform, Property 27: Invalid move rejected with 400`
    - Generate moves where `to_position` is not in valid moves; assert HTTP 400
    - _Requirements: 17.4_

  - [x] 19.8 Write property test for wrong-turn move rejected with 400 (P28)
    - `# Feature: cardflow-platform, Property 28: Wrong-turn move rejected with 400`
    - Submit move for piece belonging to the non-active player; assert HTTP 400
    - _Requirements: 17.3_

  - [x] 19.9 Write property test for pvc response reflects both moves (P30)
    - `# Feature: cardflow-platform, Property 30: pvc response reflects both moves`
    - In `pvc` session, apply player move that doesn't end game; assert response reflects both moves applied and `current_turn="player"`
    - _Requirements: 19.1, 19.6_

- [x] 20. Refactor Board component to pure rendering layer
  - [x] 20.1 Rewrite `frontend/components/Board.tsx`
    - Remove all client-side game state, move validation, damage calculation, and turn management
    - Accept `boardState: BoardPieceState[]`, `sessionId: string`, `currentTurn`, `winner` as props
    - On piece selection, call `GET /game/{sessionId}/valid-moves/{pieceId}` and highlight returned squares
    - On destination click, call `POST /game/{sessionId}/move`; pass updated `SessionResponse` to parent via `onSessionUpdate` callback
    - Disable board interaction while API call is in progress
    - Display error message on API failure without crashing
    - _Requirements: 20.1, 20.3, 20.4, 20.5, 20.6, 20.7_

- [x] 21. Refactor Game page to use session API
  - [x] 21.1 Update `frontend/app/game/page.tsx`
    - On mount, call `POST /game/session` with selected piece IDs and game mode; store `session_id` and initial `SessionResponse`
    - Pass `boardState`, `sessionId`, `currentTurn`, `winner` from `SessionResponse` down to `Board`
    - Handle `onSessionUpdate` callback from `Board` to update local `SessionResponse` state
    - Add game mode selector (pvp / pvc) and AI depth input before session creation
    - _Requirements: 20.2, 20.3, 20.4, 20.5_

- [x] 22. Add frontend TypeScript types for session API
  - [x] 22.1 Extend `frontend/types/index.ts` with session types
    - Add `BoardPieceState`, `SessionResponse`, `SessionCreateRequest`, `MoveRequest`, `ValidMovesResponse`
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

- [ ] 23. Final checkpoint — Ensure all tests pass after game session feature
  - Ensure all backend and frontend tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use Hypothesis (backend, min 100 examples) and fast-check (frontend, `numRuns: 100`)
- Each property test must include the comment tag `# Feature: cardflow-platform, Property N: <text>`
- Backend tests run against an isolated test database reset between tests
- Frontend tests use `jsdom` environment via Vitest
- Properties P22–P30 cover the new game session management and Minimax AI feature
- The `game_sessions` table stores `board_state` as JSONB to avoid a separate join table for session-scoped piece positions
