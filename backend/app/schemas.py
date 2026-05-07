import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ElementEnum(str, Enum):
    Fire = "Fire"
    Grass = "Grass"
    Water = "Water"
    Electric = "Electric"
    Air = "Air"
    Earth = "Earth"
    Neutral = "Neutral"


class ArtworkCreate(BaseModel):
    image_url: str
    prompt: Optional[str] = None
    seed: Optional[int] = None

    @field_validator("image_url")
    @classmethod
    def image_url_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("image_url must not be empty")
        return v


class ArtworkResponse(BaseModel):
    id: uuid.UUID
    image_url: str
    prompt: Optional[str]
    seed: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class GamePieceCreate(BaseModel):
    artwork_id: uuid.UUID
    name: str
    element: ElementEnum
    base_hp: int = Field(ge=75, le=100)
    base_atk: int = Field(ge=50, le=75)

    @field_validator("base_hp")
    @classmethod
    def hp_range(cls, v: int) -> int:
        if v < 75 or v > 100:
            raise ValueError("base_hp must be between 75 and 100")
        return v

    @field_validator("base_atk")
    @classmethod
    def atk_range(cls, v: int) -> int:
        if v < 50 or v > 75:
            raise ValueError("base_atk must be between 50 and 75")
        return v

    @field_validator("base_atk")
    @classmethod
    def hp_atk_sum(cls, v: int, info) -> int:
        hp = info.data.get("base_hp")
        if hp is not None and hp + v != 150:
            raise ValueError(f"base_hp + base_atk must equal 150 (got {hp} + {v} = {hp + v})")
        return v


class GamePieceResponse(BaseModel):
    id: uuid.UUID
    artwork_id: uuid.UUID
    name: str
    element: ElementEnum
    base_hp: int
    base_atk: int
    artwork: ArtworkResponse

    model_config = {"from_attributes": True}


class GameStateCreate(BaseModel):
    piece_id: uuid.UUID
    current_hp: int = Field(ge=0)
    is_evolved: bool = False


class GameStateResponse(BaseModel):
    id: uuid.UUID
    piece_id: uuid.UUID
    current_hp: int
    is_evolved: bool

    model_config = {"from_attributes": True}


class GameModeEnum(str, Enum):
    pvp = "pvp"
    pvc = "pvc"
    pvp_remote = "pvp_remote"


class DifficultyEnum(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class OwnerEnum(str, Enum):
    player = "player"
    opponent = "opponent"


class BoardPieceState(BaseModel):
    piece_id: uuid.UUID
    owner: OwnerEnum
    position: list[int]  # [row, col]
    current_hp: int = Field(ge=0)
    is_evolved: bool = False


class BreachActivation(BaseModel):
    """Describes a Breach (Oltre la linea) ability activation.

    - piece_id: the piece that evolved and triggered the AOE
    - element: the element of the triggering piece (determines visual color)
    - targets: list of pieces hit, with damage applied
    - affected_squares: all diagonal squares hit (for visual animation)
    """
    piece_id: uuid.UUID
    element: str
    targets: list["BreachTarget"]
    affected_squares: list[list[int]]  # [row, col] hit positions


class BreachTarget(BaseModel):
    piece_id: uuid.UUID
    damage: float
    current_hp_after: float
    was_removed: bool


class SessionCreateRequest(BaseModel):
    player_piece_ids: list[uuid.UUID]
    opponent_piece_ids: list[uuid.UUID] = []
    game_mode: GameModeEnum
    ai_depth: int = Field(default=3, gt=0)
    difficulty: Optional[DifficultyEnum] = None


class SessionResponse(BaseModel):
    session_id: uuid.UUID
    game_mode: GameModeEnum
    current_turn: OwnerEnum
    winner: Optional[str] = None
    board_state: list[BoardPieceState]
    breach_activations: list[BreachActivation] = []  # NEW
    status: Optional[str] = None
    player_user_id: Optional[str] = None
    opponent_user_id: Optional[str] = None
    difficulty: Optional[str] = None


class MoveRequest(BaseModel):
    piece_id: uuid.UUID
    to_position: list[int]  # [row, col]


class JoinSessionRequest(BaseModel):
    opponent_piece_ids: list[uuid.UUID]


class ValidMovesResponse(BaseModel):
    piece_id: uuid.UUID
    moves: list[list[int]]  # list of [row, col]

