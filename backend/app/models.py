import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class Artwork(SQLModel, table=True):
    __tablename__ = "artworks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    image_url: str
    prompt: Optional[str] = None
    seed: Optional[int] = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class GamePiece(SQLModel, table=True):
    __tablename__ = "game_pieces"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    artwork_id: uuid.UUID = Field(
        sa_column=sa.Column(
            sa.Uuid,
            sa.ForeignKey("artworks.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    name: str
    element: str  # Fire | Grass | Water | Electric | Air | Earth | Neutral
    base_hp: int
    base_atk: int


class GameState(SQLModel, table=True):
    __tablename__ = "game_state"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    piece_id: uuid.UUID = Field(
        sa_column=sa.Column(
            sa.Uuid,
            sa.ForeignKey("game_pieces.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    current_hp: int
    is_evolved: bool = Field(default=False)
