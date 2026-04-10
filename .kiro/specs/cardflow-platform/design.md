# Design Document: CardFlow Platform

## Overview

CardFlow is a full-stack monorepo platform for creating and managing AI-generated game assets for a Battle Checkers game. The central architectural principle is **artwork-game decoupling**: a single image in the master artwork library can be assigned to any game piece without modifying the original record. All game-specific UI — stats, health bars, element icons, evolved status — is rendered as dynamic React overlays on the frontend.

**Tech Stack:**
- Backend: FastAPI + PostgreSQL (SQLAlchemy/SQLModel ORM) + Pydantic v2
- Frontend: Next.js 14 (App Router) + Tailwind CSS
- Deployment: Docker + Railway.app
- Monorepo root with `/backend` and `/frontend` directories

**Key Design Decisions:**
- Game entities hold foreign keys to `artworks`, never the reverse. This allows unlimited game types to be added without touching the `artworks` table.
- All game-specific visual rendering is done via React overlay components layered over a circular base `<img>` tag. No image manipulation occurs server-side.
- The FastAPI backend uses a global exception handler to ensure all error responses are JSON, never HTML.
- Damage calculation is a pure utility function (`calculate_damage`) that applies the Elemental Matrix deterministically.

---

## Architecture

```mermaid
graph TD
    subgraph Frontend [Next.js 14 Frontend]
        Dashboard[Dashboard Page]
        PieceRenderer[PieceRenderer Component]
        Board[Board Component 8x8]
        HP_Bar[HP_Bar Overlay]
        Element_Icon[Element_Icon Overlay]
        Evolved_Crown[Evolved_Crown Overlay]
    end

    subgraph Backend [FastAPI Backend]
        ArtworksRouter[/artworks router]
        PiecesRouter[/pieces router]
        ErrorHandler[Global Error Handler]
        CalcDamage[calculate_damage utility]
    end

    subgraph DB [PostgreSQL]
        ArtworksTable[(artworks)]
        GamePiecesTable[(game_pieces)]
        GameStateTable[(game_state)]
    end

    Dashboard -->|GET /artworks| ArtworksRouter
    Dashboard -->|POST /pieces| PiecesRouter
    Board --> PieceRenderer
    PieceRenderer --> HP_Bar
    PieceRenderer --> Element_Icon
    PieceRenderer --> Evolved_Crown

    ArtworksRouter --> ArtworksTable
    PiecesRouter --> GamePiecesTable
    GamePiecesTable -->|FK artwork_id| ArtworksTable
    GameStateTable -->|FK piece_id| GamePiecesTable

    ErrorHandler -.->|wraps| ArtworksRouter
    ErrorHandler -.->|wraps| PiecesRouter
    CalcDamage -.->|used by| Board
```

**Request flow:**
1. The Dashboard fetches all artworks on load.
2. User selects an artwork and fills in piece stats (name, element, base_hp, base_atk).
3. Frontend submits a `POST /pieces` request.
4. Backend validates via Pydantic, persists via SQLModel, returns a `GamePieceResponse` with joined artwork data.
5. Frontend passes the response to `PieceRenderer`, which renders the circular token with HP_Bar, Element_Icon, and Evolved_Crown overlays.
6. During a match, the Board component manages `GameState` locally and invokes `calculate_damage` on attacks.

---

## Components and Interfaces

### Backend

#### FastAPI Application (`backend/app/main.py`)
- Mounts `artworks_router`, `pieces_router`
- Registers global exception handlers for `HTTPException` and unhandled `Exception`
- Reads `DATABASE_URL` from environment at startup; raises `RuntimeError` if absent

#### Artworks Router (`backend/app/routers/artworks.py`)
```
POST /artworks    → ArtworkCreate → ArtworkResponse (201)
GET  /artworks    → list[ArtworkResponse] (200)
```

#### Pieces Router (`backend/app/routers/pieces.py`)
```
POST /pieces      → GamePieceCreate → GamePieceResponse (201)
GET  /pieces      → list[GamePieceResponse] (200)
```

#### Damage Utility (`backend/app/utils/damage.py`)
```python
def calculate_damage(attacker_element: str, target_element: str, base_atk: int) -> float:
    """Returns base_atk * elemental_multiplier for the given element pair."""
```

The Elemental Matrix is encoded as a lookup dict; any pair not in the dict defaults to 1x.

#### ORM Models (`backend/app/models.py`)
- `Artwork` — maps to `artworks` table
- `GamePiece` — maps to `game_pieces` table, FK to `Artwork`
- `GameState` — maps to `game_state` table, FK to `GamePiece`

#### Pydantic Schemas (`backend/app/schemas.py`)
- `ArtworkCreate`, `ArtworkResponse`
- `GamePieceCreate`, `GamePieceResponse`
- `GameStateCreate`, `GameStateResponse`

### Frontend

#### Dashboard Page (`frontend/app/page.tsx`)
- Fetches artworks on mount via `GET /artworks`
- Renders artwork thumbnails; on selection shows piece creation form pre-populated with `artwork_id`
- Submits to `POST /pieces` and renders result via `PieceRenderer`
- Disables submit button during in-flight requests
- Displays error messages on API failure without crashing

#### PieceRenderer (`frontend/components/PieceRenderer.tsx`)
```typescript
interface PieceRendererProps {
  data: GamePieceResponse;
  state: { current_hp: number; is_evolved: boolean };
}
```
- Renders `data.artwork.image_url` as a circular element using `rounded-full` and `object-cover`
- Falls back to a static placeholder image if `image_url` is absent
- Renders `HP_Bar`, `Element_Icon`, and conditionally `Evolved_Crown` as absolutely-positioned overlays

#### HP_Bar (`frontend/components/HP_Bar.tsx`)
```typescript
interface HP_BarProps { current_hp: number; base_hp: number; }
```
- Displays current HP value and a proportional bar

#### Element_Icon (`frontend/components/Element_Icon.tsx`)
```typescript
interface Element_IconProps { element: string; }
```
- Displays the element name or a corresponding icon badge

#### Evolved_Crown (`frontend/components/Evolved_Crown.tsx`)
- Renders a crown/star icon; only mounted when `is_evolved` is true

#### Board (`frontend/components/Board.tsx`)
```typescript
interface BoardProps {
  pieces: Array<{ piece: GamePieceResponse; state: GameState; position: [number, number]; owner: 'player' | 'opponent' }>;
}
```
- Renders an 8×8 grid of alternating light/dark squares via Tailwind CSS
- Places each active piece on its square using `PieceRenderer`
- On piece selection, computes valid diagonal moves (forward only; forward + backward if evolved)
- On move to an occupied opponent square, invokes `calculate_damage` and updates `current_hp`
- Removes pieces with `current_hp <= 0`; sets `is_evolved = true` when a piece reaches the opponent's last row

---

## Data Models

### `artworks` table

| Column     | Type        | Constraints                     |
|------------|-------------|---------------------------------|
| id         | UUID        | PK, default gen_random_uuid()   |
| image_url  | VARCHAR     | NOT NULL                        |
| prompt     | TEXT        | NULLABLE                        |
| seed       | INTEGER     | NULLABLE                        |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now()         |

### `game_pieces` table

| Column     | Type    | Constraints                              |
|------------|---------|------------------------------------------|
| id         | UUID    | PK, default gen_random_uuid()            |
| artwork_id | UUID    | NOT NULL, FK → artworks.id RESTRICT      |
| name       | VARCHAR | NOT NULL                                 |
| element    | VARCHAR | NOT NULL, CHECK IN (Fire, Grass, Water, Electric, Air, Earth, Neutral) |
| base_hp    | INTEGER | NOT NULL                                 |
| base_atk   | INTEGER | NOT NULL                                 |

### `game_state` table

| Column     | Type    | Constraints                                  |
|------------|---------|----------------------------------------------|
| id         | UUID    | PK, default gen_random_uuid()                |
| piece_id   | UUID    | NOT NULL, FK → game_pieces.id RESTRICT       |
| current_hp | INTEGER | NOT NULL                                     |
| is_evolved | BOOLEAN | NOT NULL, DEFAULT false                      |

**Referential integrity:**
- `game_pieces.artwork_id` uses `ON DELETE RESTRICT` — artwork deletion blocked when pieces reference it (Req 1.4).
- `game_state.piece_id` uses `ON DELETE RESTRICT` — piece deletion blocked when game_state rows reference it (Req 3.4).

### SQLModel ORM Sketch

```python
class Artwork(SQLModel, table=True):
    __tablename__ = "artworks"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    image_url: str
    prompt: Optional[str] = None
    seed: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GamePiece(SQLModel, table=True):
    __tablename__ = "game_pieces"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    artwork_id: uuid.UUID = Field(foreign_key="artworks.id")
    name: str
    element: str  # Element enum: Fire | Grass | Water | Electric | Air | Earth | Neutral
    base_hp: int
    base_atk: int

class GameState(SQLModel, table=True):
    __tablename__ = "game_state"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    piece_id: uuid.UUID = Field(foreign_key="game_pieces.id")
    current_hp: int
    is_evolved: bool = False
```

### Pydantic Schema Sketch

```python
class ArtworkCreate(BaseModel):
    image_url: str  # non-empty enforced via @field_validator
    prompt: Optional[str] = None
    seed: Optional[int] = None

class ArtworkResponse(BaseModel):
    id: uuid.UUID
    image_url: str
    prompt: Optional[str]
    seed: Optional[int]
    created_at: datetime

class GamePieceCreate(BaseModel):
    artwork_id: uuid.UUID
    name: str
    element: ElementEnum  # Fire | Grass | Water | Electric | Air | Earth | Neutral
    base_hp: int = Field(gt=0)
    base_atk: int = Field(gt=0)

class GamePieceResponse(GamePieceCreate):
    id: uuid.UUID
    artwork: ArtworkResponse

class GameStateCreate(BaseModel):
    piece_id: uuid.UUID
    current_hp: int = Field(ge=0)
    is_evolved: bool = False

class GameStateResponse(GameStateCreate):
    id: uuid.UUID
```

### Elemental Matrix and `calculate_damage`

```python
ELEMENTAL_MATRIX: dict[tuple[str, str], float] = {
    ("Fire",     "Grass"):    2.0,
    ("Grass",    "Fire"):     0.5,
    ("Grass",    "Water"):    2.0,
    ("Water",    "Grass"):    0.5,
    ("Water",    "Fire"):     2.0,
    ("Fire",     "Water"):    0.5,
    ("Electric", "Air"):      2.0,
    ("Air",      "Electric"): 0.5,
    ("Air",      "Earth"):    2.0,
    ("Earth",    "Air"):      0.5,
    ("Earth",    "Electric"): 2.0,
    ("Electric", "Earth"):    0.5,
}

def calculate_damage(attacker_element: str, target_element: str, base_atk: int) -> float:
    multiplier = ELEMENTAL_MATRIX.get((attacker_element, target_element), 1.0)
    return base_atk * multiplier
```

Same-element pairs and any pair involving Neutral are not in the matrix, so they default to 1x.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Artwork creation round-trip

*For any* valid `ArtworkCreate` payload (non-empty `image_url`, optional `prompt` and `seed`), submitting a `POST /artworks` request should result in the artwork being persisted and the response body containing the same `image_url`, `prompt`, and `seed` values, with HTTP 201.

**Validates: Requirements 6.1**

---

### Property 2: Artwork list completeness

*For any* set of artworks persisted to the database, a `GET /artworks` request should return a list that contains every one of those artworks (by `id`).

**Validates: Requirements 6.2**

---

### Property 3: Game piece creation round-trip

*For any* valid `GamePieceCreate` payload referencing an existing artwork, submitting a `POST /pieces` request should persist the game piece and return a `GamePieceResponse` containing the same field values plus the joined `ArtworkResponse`, with HTTP 201.

**Validates: Requirements 7.1**

---

### Property 4: Game piece list completeness with joined artwork

*For any* set of game pieces persisted to the database, a `GET /pieces` request should return a list containing every one of those pieces (by `id`), each with its joined `ArtworkResponse` fields populated.

**Validates: Requirements 7.3**

---

### Property 5: Non-existent artwork_id returns 404

*For any* UUID that does not correspond to an existing artwork, submitting a `POST /pieces` request with that `artwork_id` should return HTTP 404 with a JSON error body.

**Validates: Requirements 7.2**

---

### Property 6: Multiple game pieces can share an artwork

*For any* existing artwork, it should be possible to create N `GamePiece` records all referencing the same `artwork_id`, without any constraint violation.

**Validates: Requirements 2.4**

---

### Property 7: Artwork deletion blocked when referenced

*For any* artwork that has at least one `GamePiece` referencing it, attempting to delete that artwork should fail with a foreign key constraint error and leave the artwork record intact.

**Validates: Requirements 1.4**

---

### Property 8: GamePiece deletion blocked when game_state references it

*For any* game piece that has at least one `GameState` row referencing it, attempting to delete that piece should fail with a foreign key constraint error and leave the piece record intact.

**Validates: Requirements 3.4**

---

### Property 9: Invalid request bodies return 422

*For any* request to `POST /artworks` or `POST /pieces` where the body is missing a required field, contains a field with an incorrect type, or contains an `element` value not in the valid enum, the API should return HTTP 422 with a JSON body describing the validation error.

**Validates: Requirements 5.7, 5.8, 5.9**

---

### Property 10: Unhandled exceptions return 500 JSON

*For any* unhandled exception raised during request processing, the error handler should return HTTP 500 with a JSON body containing both `detail` and `type` fields (never an HTML page).

**Validates: Requirements 8.2**

---

### Property 11: HTTP exceptions return correct status code with JSON

*For any* `HTTPException` raised with a specific status code, the error handler should return that exact status code with a JSON body containing a `detail` field.

**Validates: Requirements 8.3**

---

### Property 12: Artwork record unchanged after game piece creation

*For any* artwork record, after creating a `GamePiece` that references it, the artwork record's fields (`image_url`, `prompt`, `seed`, `created_at`) should be identical to their values before the operation.

**Validates: Requirements 13.2**

---

### Property 13: Elemental Matrix correctness

*For any* element pair defined in the Elemental Matrix, `calculate_damage(attacker, target, base_atk)` should return exactly `base_atk * expected_multiplier` as specified (2x for advantaged pairs, 0.5x for disadvantaged pairs, 1x for all others including same-element and Neutral).

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

---

### Property 14: calculate_damage always returns a positive value

*For any* valid element pair and any positive integer `base_atk`, `calculate_damage` should return a value strictly greater than zero.

**Validates: Requirements 4.5**

---

### Property 15: PieceRenderer renders circular token with correct overlays

*For any* `GamePieceResponse` and `GameState`, `PieceRenderer` should render the artwork as a circular element (with `rounded-full` and `object-cover`), display the `current_hp` in the HP_Bar overlay, display the element in the Element_Icon overlay, and render the Evolved_Crown overlay if and only if `is_evolved` is true.

**Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**

---

### Property 16: Board movement highlights correct diagonal squares

*For any* piece position on the board, the set of highlighted valid move squares should be exactly the diagonal-forward squares (plus diagonal-backward squares if the piece is evolved), and no other squares.

**Validates: Requirements 11.3, 11.4**

---

### Property 17: Attack reduces target HP by calculate_damage result

*For any* attacker and target piece on the board, when an attack is performed, the target's `current_hp` should decrease by exactly `calculate_damage(attacker.element, target.element, attacker.base_atk)`.

**Validates: Requirements 11.6, 11.7**

---

### Property 18: Piece removal and survival based on HP after attack

*For any* attack, if the resulting `current_hp` is zero or below the target piece should be removed from the board; if the resulting `current_hp` is above zero the target piece should remain on the board with its updated `current_hp`.

**Validates: Requirements 11.8, 11.9**

---

### Property 19: Evolution triggered on reaching opponent's last row

*For any* game piece that moves to the opponent's last row, `is_evolved` should be set to true for that piece.

**Validates: Requirements 11.10**

---

### Property 20: API failure shows error without crash

*For any* API error response (4xx or 5xx) received during a form submission, the Dashboard should display a user-visible error message and remain interactive (no unhandled exception or blank page).

**Validates: Requirements 12.4**

---

### Property 21: Submit button disabled during in-flight request

*For any* form submission in progress, the submit button should be in a disabled state until the request completes (success or failure).

**Validates: Requirements 12.5**

---

## Error Handling

### Backend

**Global Exception Handler** (`backend/app/main.py`):

```python
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__}
    )
```

**404 on missing artwork_id**: The pieces router checks for artwork existence before insert:

```python
artwork = session.get(Artwork, body.artwork_id)
if not artwork:
    raise HTTPException(status_code=404, detail="Artwork not found")
```

**422 Validation errors**: Handled automatically by FastAPI/Pydantic. The global handler does not intercept these — FastAPI returns a structured 422 response by default.

**Startup configuration error**: `DATABASE_URL` is read at app startup; if absent, a `RuntimeError` is raised before the server begins accepting connections.

### Frontend

- All API calls are wrapped in `try/catch` blocks.
- On error, an error state variable is set and rendered as a visible message in the UI.
- The submit button's `disabled` prop is tied to a loading state boolean, set to `true` on submit and `false` on completion.
- Missing `image_url` in `PieceRenderer` falls back to a static placeholder image path.
- Board attack errors (e.g. invalid state) are caught and surfaced as non-crashing UI messages.

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. They are complementary:
- Unit tests catch concrete bugs with specific known inputs and edge cases.
- Property tests verify universal correctness across a wide range of generated inputs.

### Backend Testing

**Framework:** pytest + [Hypothesis](https://hypothesis.readthedocs.io/) for property-based testing

**Unit Tests (pytest):**
- Specific examples: create an artwork with known values, assert response fields match
- Integration: test each router endpoint against a test database (SQLite in-memory or PostgreSQL via testcontainers)
- Edge cases: empty `image_url`, missing required fields, non-existent `artwork_id`
- Error handler: verify 500 JSON shape and 404 JSON shape
- `calculate_damage`: enumerate all 12 directional element pairs and verify exact multipliers; verify same-element and Neutral pairs return 1x

**Property Tests (Hypothesis, minimum 100 iterations each):**

Each property test must be tagged with a comment referencing the design property:
```
# Feature: cardflow-platform, Property N: <property_text>
```

| Property | Test Description |
|----------|-----------------|
| P1  | Generate random valid ArtworkCreate; POST and assert response fields match input |
| P2  | Generate N random artworks; POST all; GET /artworks; assert all IDs present |
| P3  | Generate random GamePieceCreate with valid artwork; POST and assert round-trip |
| P4  | POST N pieces; GET /pieces; assert all IDs present with artwork fields populated |
| P5  | Generate random UUIDs not in DB; POST /pieces; assert 404 |
| P6  | Generate one artwork; create N GamePieces referencing it; assert no errors |
| P7  | Create artwork with GamePiece references; attempt DELETE; assert failure and artwork still exists |
| P8  | Create GamePiece with GameState references; attempt DELETE; assert failure and piece still exists |
| P9  | Generate invalid request bodies (missing fields, wrong types, invalid enum); assert 422 |
| P10 | Trigger unhandled exception in handler; assert 500 JSON with `detail` and `type` |
| P11 | Raise HTTPException with random 4xx/5xx code; assert response matches |
| P12 | Create game entity; fetch artwork before and after; assert fields unchanged |
| P13 | For each element pair in ELEMENTAL_MATRIX, generate random positive base_atk; assert calculate_damage returns base_atk * expected_multiplier; also test same-element and Neutral pairs return 1x |
| P14 | Generate random element pairs and positive base_atk; assert calculate_damage > 0 |

### Frontend Testing

**Framework:** [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) + [fast-check](https://fast-check.io/) for property-based testing

**Unit Tests:**
- `PieceRenderer`: renders `rounded-full` and `object-cover` on the image element; renders placeholder when `image_url` absent
- `HP_Bar`: renders the correct `current_hp` value for a known input
- `Element_Icon`: renders the correct element label for each of the 7 elements
- `Evolved_Crown`: present when `is_evolved=true`, absent when `is_evolved=false`
- `Board`: renders 8×8 grid; highlights correct diagonal squares for a known piece position; invokes `calculate_damage` on attack
- Dashboard: fetches artworks on mount; shows error message on API failure; pre-populates `artwork_id` on artwork selection

**Property Tests (fast-check, minimum 100 iterations each):**

```
// Feature: cardflow-platform, Property N: <property_text>
```

| Property | Test Description |
|----------|-----------------|
| P15 | Generate random GamePieceResponse + GameState; render PieceRenderer; assert rounded-full, object-cover, HP_Bar shows current_hp, Element_Icon shows element, Evolved_Crown present iff is_evolved=true |
| P16 | Generate random piece positions and evolved status; render Board with selection; assert highlighted squares are exactly the correct diagonals |
| P17 | Generate random attacker/target element pairs and base_atk; simulate board attack; assert target current_hp reduced by calculate_damage result |
| P18 | Generate attacks where resulting HP ≤ 0; assert target removed from board; generate attacks where resulting HP > 0; assert target remains with updated HP |
| P19 | Generate piece positions adjacent to opponent's last row; simulate move to last row; assert is_evolved=true |
| P20 | Mock API error; simulate form submission; assert error message visible and page interactive |
| P21 | Simulate form submission in progress; assert submit button is disabled |

### Test Configuration

- Property tests: minimum **100 iterations** per test (configured via Hypothesis `settings(max_examples=100)` and fast-check `{ numRuns: 100 }`)
- Backend tests run against an isolated test database (reset between tests)
- Frontend tests use `jsdom` environment via Vitest
