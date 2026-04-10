# Requirements Document

## Introduction

CardFlow is a full-stack web platform for creating and managing AI-generated game assets for a Battle Checkers game. The core architectural principle is the decoupling of source artwork from game context: a single image in the master artwork library can be assigned to any game piece without modifying the original file. All game-specific UI — stats, health bars, element icons, evolved status — is rendered as dynamic React overlays on the frontend. The system is built as a monorepo with a FastAPI backend (PostgreSQL via SQLAlchemy/SQLModel), a Next.js 14 frontend with Tailwind CSS, and Docker-based deployment targeting Railway.app.

## Glossary

- **System**: The CardFlow platform as a whole
- **API**: The FastAPI backend service
- **UI**: The Next.js frontend application
- **Artwork**: A master image record stored in the `artworks` table, representing a single AI-generated image independent of any game context
- **Game_Piece**: A game entity in the `game_pieces` table that references an Artwork and adds Battle Checkers-specific stats (name, element, base_hp, base_atk)
- **Element**: An enumerated attribute of a Game_Piece; one of: Fire, Grass, Water, Electric, Air, Earth, Neutral
- **Elemental_Multiplier**: A damage coefficient derived from the attacker's Element and the target's Element, as defined by the Elemental Matrix
- **Elemental_Matrix**: The full set of element interaction rules that determine the Elemental_Multiplier for any attacker/target element pair
- **Game_State**: A transient record (scoped to a session) tracking `current_hp` and `is_evolved` for a Game_Piece during an active match
- **Evolved**: The status of a Game_Piece that has reached the opponent's last row; an Evolved piece may move both forward and backward diagonally
- **Database**: The PostgreSQL instance accessed via SQLAlchemy/SQLModel ORM
- **ORM**: SQLAlchemy or SQLModel object-relational mapper
- **Schema**: Pydantic models used for API request/response validation
- **PieceRenderer**: The central Next.js component that renders a Game_Piece as a circular token with artwork background and overlays for HP, element, and evolved status
- **HP_Bar**: A UI overlay element on the PieceRenderer that displays the current HP of a Game_Piece
- **Element_Icon**: A UI overlay element on the PieceRenderer that displays the Element of a Game_Piece
- **Evolved_Crown**: A UI overlay element on the PieceRenderer that displays a crown or star icon when `is_evolved` is true
- **Board**: An 8×8 grid UI component where Game_Pieces are placed and moved
- **Dashboard**: The frontend page where users browse Artworks and assign them to game pieces
- **Error_Handler**: The FastAPI global exception handler that returns JSON-formatted errors
- **Dockerfile**: The container build file for the backend service

---

## Requirements

### Requirement 1: Database Schema — Artworks

**User Story:** As a developer, I want a master `artworks` table that stores AI-generated images independently of any game context, so that a single image can be reused across multiple game pieces without duplication.

#### Acceptance Criteria

1. THE Database SHALL contain an `artworks` table with columns: `id` (UUID primary key), `image_url` (non-nullable string), `prompt` (nullable string), `seed` (nullable integer), and `created_at` (timestamp with timezone, defaulting to the current time).
2. THE ORM SHALL define an `Artwork` model mapping to the `artworks` table.
3. THE Database SHALL enforce uniqueness of `id` across all rows in the `artworks` table.
4. WHEN an Artwork is deleted, THE Database SHALL prevent deletion if any `game_pieces` rows still reference that Artwork via foreign key.

---

### Requirement 2: Database Schema — Game Pieces

**User Story:** As a developer, I want a `game_pieces` table that links to an existing Artwork and stores Battle Checkers-specific stats, so that game data is kept separate from the source image.

#### Acceptance Criteria

1. THE Database SHALL contain a `game_pieces` table with columns: `id` (UUID primary key), `artwork_id` (UUID foreign key referencing `artworks.id`), `name` (non-nullable string), `element` (non-nullable enum: Fire, Grass, Water, Electric, Air, Earth, Neutral), `base_hp` (non-nullable integer), and `base_atk` (non-nullable integer).
2. THE ORM SHALL define a `GamePiece` model with a foreign key relationship to the `Artwork` model.
3. IF an `artwork_id` referencing a non-existent Artwork is provided, THEN THE Database SHALL reject the insert and raise a foreign key constraint error.
4. THE Database SHALL allow multiple `game_pieces` rows to reference the same `artwork_id`.

---

### Requirement 3: Database Schema — Game State (MVP)

**User Story:** As a developer, I want a `game_state` table that tracks the mutable in-session state of each Game_Piece, so that HP changes and evolution status during a match are persisted without altering the base Game_Piece record.

#### Acceptance Criteria

1. THE Database SHALL contain a `game_state` table with columns: `id` (UUID primary key), `piece_id` (UUID foreign key referencing `game_pieces.id`), `current_hp` (non-nullable integer), and `is_evolved` (non-nullable boolean, defaulting to false).
2. THE ORM SHALL define a `GameState` model with a foreign key relationship to the `GamePiece` model.
3. IF a `piece_id` referencing a non-existent Game_Piece is provided, THEN THE Database SHALL reject the insert and raise a foreign key constraint error.
4. WHEN a Game_Piece is deleted, THE Database SHALL prevent deletion if any `game_state` rows still reference that Game_Piece via foreign key.

---

### Requirement 4: Elemental Matrix and Damage Calculation

**User Story:** As a developer, I want a utility function that calculates attack damage using the Elemental Matrix, so that combat outcomes are consistent and deterministic across all game sessions.

#### Acceptance Criteria

1. THE System SHALL define an Elemental_Matrix with the following multipliers:
   - Fire vs Grass: 2x; Grass vs Fire: 0.5x
   - Grass vs Water: 2x; Water vs Grass: 0.5x
   - Water vs Fire: 2x; Fire vs Water: 0.5x
   - Electric vs Air: 2x; Air vs Electric: 0.5x
   - Air vs Earth: 2x; Earth vs Air: 0.5x
   - Earth vs Electric: 2x; Electric vs Earth: 0.5x
   - All other element pairings: 1x (Neutral)
2. THE System SHALL provide a `calculate_damage(attacker_element, target_element, base_atk)` utility function that returns `base_atk * Elemental_Multiplier` for the given element pair.
3. WHEN `attacker_element` and `target_element` are the same, THE System SHALL apply a 1x multiplier.
4. WHEN either `attacker_element` or `target_element` is Neutral, THE System SHALL apply a 1x multiplier.
5. THE `calculate_damage` function SHALL return a numeric value greater than zero for any valid positive `base_atk` input.

---

### Requirement 5: Pydantic Schemas for Validation

**User Story:** As a developer, I want strict Pydantic schemas for all API inputs and outputs, so that invalid data is rejected before reaching the database layer.

#### Acceptance Criteria

1. THE Schema SHALL define an `ArtworkCreate` model requiring `image_url` (non-empty string) and accepting optional `prompt` (string) and `seed` (integer).
2. THE Schema SHALL define an `ArtworkResponse` model including `id`, `image_url`, `prompt`, `seed`, and `created_at`.
3. THE Schema SHALL define a `GamePieceCreate` model requiring `artwork_id`, `name`, `element` (one of the seven valid Element values), `base_hp` (positive integer), and `base_atk` (positive integer).
4. THE Schema SHALL define a `GamePieceResponse` model including all `GamePiece` fields plus the joined `ArtworkResponse`.
5. THE Schema SHALL define a `GameStateCreate` model requiring `piece_id`, `current_hp` (non-negative integer), and accepting optional `is_evolved` (boolean, default false).
6. THE Schema SHALL define a `GameStateResponse` model including all `GameState` fields.
7. WHEN a request body is missing a required field, THE API SHALL return an HTTP 422 response with a JSON body describing the validation error.
8. WHEN a request body contains a field with an incorrect type, THE API SHALL return an HTTP 422 response with a JSON body describing the type mismatch.
9. WHEN a request body contains an `element` value not in the valid Element enum, THE API SHALL return an HTTP 422 response with a JSON body describing the invalid value.

---

### Requirement 6: Artwork Registration Endpoint

**User Story:** As a developer, I want a `POST /artworks` endpoint, so that newly generated images can be registered in the master library before being assigned to any game piece.

#### Acceptance Criteria

1. WHEN a `POST /artworks` request is received with a valid `ArtworkCreate` body, THE API SHALL persist the Artwork to the Database and return an `ArtworkResponse` with HTTP 201.
2. WHEN a `GET /artworks` request is received, THE API SHALL return a list of all `ArtworkResponse` objects with HTTP 200.
3. IF a `POST /artworks` request body fails Pydantic validation, THEN THE API SHALL return an HTTP 422 response with a JSON body describing the error.

---

### Requirement 7: Game Piece Endpoints

**User Story:** As a frontend developer, I want API endpoints to create and retrieve game pieces, so that the UI can assign artworks to Battle Checkers pieces and display them with their stats.

#### Acceptance Criteria

1. WHEN a `POST /pieces` request is received with a valid `GamePieceCreate` body, THE API SHALL persist the Game_Piece linked to the specified Artwork and return a `GamePieceResponse` with HTTP 201.
2. IF a `POST /pieces` request references a non-existent `artwork_id`, THEN THE API SHALL return an HTTP 404 response with a JSON error body.
3. WHEN a `GET /pieces` request is received, THE API SHALL return a list of all `GamePieceResponse` objects with their joined Artwork data, with HTTP 200.

---

### Requirement 8: Global Error Handler

**User Story:** As a frontend developer, I want all API errors to return consistent JSON responses, so that the UI can handle errors uniformly without parsing HTML or plain-text error bodies.

#### Acceptance Criteria

1. THE Error_Handler SHALL intercept all unhandled exceptions raised during request processing.
2. WHEN an unhandled exception occurs, THE Error_Handler SHALL return an HTTP 500 response with a JSON body containing `detail` and `type` fields.
3. WHEN an HTTP exception is raised with a specific status code, THE Error_Handler SHALL return that status code with a JSON body containing a `detail` field.
4. THE API SHALL never return an HTML error page for any request to an API route.

---

### Requirement 9: Backend Configuration and Containerization

**User Story:** As a DevOps engineer, I want the backend to read its database connection from an environment variable and be containerizable, so that it can be deployed to Railway.app without code changes.

#### Acceptance Criteria

1. THE API SHALL read the database connection string exclusively from the `DATABASE_URL` environment variable.
2. IF the `DATABASE_URL` environment variable is not set at startup, THEN THE API SHALL raise a configuration error and exit before accepting requests.
3. THE Dockerfile SHALL build a production image using a Python 3.11+ base, install dependencies from `requirements.txt`, and configure Gunicorn with Uvicorn workers as the process manager.
4. THE Dockerfile SHALL read the listening port from the `PORT` environment variable and SHALL use that value as the Gunicorn bind port, defaulting to 8000 if `PORT` is not set.
5. WHERE a `docker-compose.yml` is provided, THE System SHALL define services for both the backend and a PostgreSQL database, linking them via the `DATABASE_URL` environment variable.

---

### Requirement 10: PieceRenderer Component

**User Story:** As a frontend developer, I want a `PieceRenderer` component that renders a Game_Piece as a circular token with its artwork and stat overlays, so that all piece-specific rendering is handled in one place.

#### Acceptance Criteria

1. THE PieceRenderer SHALL accept a `data` prop containing a `GamePieceResponse` and a `state` prop containing the current `GameState` (current_hp, is_evolved).
2. THE PieceRenderer SHALL render the Artwork `image_url` as a circular element using the CSS `rounded-full` class with `object-cover` applied to the background image.
3. THE PieceRenderer SHALL render the HP_Bar overlay showing the `current_hp` value from the `state` prop.
4. THE PieceRenderer SHALL render the Element_Icon overlay displaying the Element of the Game_Piece.
5. WHEN `state.is_evolved` is true, THE PieceRenderer SHALL render the Evolved_Crown overlay (a crown or star icon) on the piece.
6. WHEN `state.is_evolved` is false, THE PieceRenderer SHALL not render the Evolved_Crown overlay.
7. IF `data` does not contain a valid `image_url`, THEN THE PieceRenderer SHALL render a placeholder image in place of the Artwork.

---

### Requirement 11: Battle Checkers Board UI

**User Story:** As a user, I want an 8×8 board where I can see and move my game pieces, so that I can play a match of Battle Checkers.

#### Acceptance Criteria

1. THE Board SHALL render as an 8×8 grid of alternating light and dark squares using Tailwind CSS.
2. THE Board SHALL render each active Game_Piece on its current square using the PieceRenderer component.
3. WHEN a player selects a Game_Piece, THE Board SHALL highlight the valid diagonal forward squares that the piece can move to.
4. WHEN a Game_Piece is Evolved, THE Board SHALL highlight valid diagonal forward AND backward squares as move targets.
5. WHEN a player selects a valid move target square, THE Board SHALL move the piece to that square.
6. WHEN a move target square contains an opponent's piece, THE Board SHALL treat the move as an Attack and invoke the damage calculation.
7. WHEN an Attack is performed, THE Board SHALL calculate damage using `calculate_damage(attacker.element, target.element, attacker.base_atk)` and reduce the target's `current_hp` by that amount.
8. WHEN a target's `current_hp` reaches zero or below after an Attack, THE Board SHALL remove the target piece from the board.
9. WHEN a target's `current_hp` remains above zero after an Attack, THE Board SHALL leave the target piece on the board with its updated `current_hp`.
10. WHEN a Game_Piece reaches the opponent's last row, THE Board SHALL set `is_evolved` to true for that piece.

---

### Requirement 12: Frontend Dashboard — Piece Assignment

**User Story:** As a user, I want a dashboard where I can browse all artworks and create game pieces from them, so that I can build out my Battle Checkers piece library from a single view.

#### Acceptance Criteria

1. WHEN the Dashboard page loads, THE UI SHALL fetch all artworks from `GET /artworks` and render each as a selectable thumbnail.
2. WHEN an artwork thumbnail is selected, THE UI SHALL display a form pre-populated with the `artwork_id` and fields for `name`, `element`, `base_hp`, and `base_atk`.
3. WHEN the piece creation form is submitted successfully, THE UI SHALL send a `POST /pieces` request and display the resulting piece using the PieceRenderer.
4. IF any API request fails, THEN THE UI SHALL display an error message to the user without crashing the page.
5. WHILE a form submission is in progress, THE UI SHALL disable the submit button to prevent duplicate submissions.

---

### Requirement 13: Artwork-Game Decoupling Principle

**User Story:** As a developer, I want the architecture to enforce a strict separation between source artwork and game context, so that new game types can be added in the future without modifying existing artwork records.

#### Acceptance Criteria

1. THE Database SHALL store all game-specific attributes exclusively in game-type tables (`game_pieces`, `game_state`) and SHALL never add game-specific columns to the `artworks` table.
2. THE API SHALL never modify an `artworks` record when creating or updating a Game_Piece or Game_State.
3. THE UI SHALL render all game-specific visual elements exclusively through overlay components on the PieceRenderer and SHALL never embed game stats into the Artwork image itself.
4. WHERE a new game type is introduced in the future, THE System SHALL accommodate it by adding a new stats table with a foreign key to `artworks` and a new renderer component, without altering existing tables or components.

---

### Requirement 14: Project Structure and Modularity

**User Story:** As a developer, I want a well-organized monorepo structure, so that the backend and frontend are independently maintainable and easy to extend.

#### Acceptance Criteria

1. THE System SHALL organize source code into a `/backend` directory containing the FastAPI app, ORM models, Pydantic schemas, and Dockerfile, and a `/frontend` directory containing the Next.js application.
2. THE API SHALL separate route handlers into distinct router modules (one for `/artworks`, one for `/pieces`) registered on the main FastAPI application.
3. THE UI SHALL use the Next.js 14 App Router with the Dashboard as the primary page and distinct component files for PieceRenderer and the Board.
4. THE System SHALL include a `docker-compose.yml` at the monorepo root that orchestrates the backend and database services.
