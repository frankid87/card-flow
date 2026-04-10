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
    base_hp: int = Field(gt=0)
    base_atk: int = Field(gt=0)


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
