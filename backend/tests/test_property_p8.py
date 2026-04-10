# Feature: cardflow-platform, Property 8: GamePiece deletion blocked when game_state references it

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, create_engine, select
from sqlalchemy import event

from app.models import Artwork, GamePiece, GameState, SQLModel


ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


def make_engine():
    """Create a fresh in-memory SQLite engine with FK enforcement."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def set_fk_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    return engine


@given(
    image_url=st.text(min_size=1, max_size=200),
    piece_name=st.text(min_size=1, max_size=100),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=1000),
    base_atk=st.integers(min_value=1, max_value=1000),
    current_hp=st.integers(min_value=0, max_value=1000),
    is_evolved=st.booleans(),
)
@settings(max_examples=100)
def test_gamepiece_deletion_blocked_when_game_state_references_it(
    image_url, piece_name, element, base_hp, base_atk, current_hp, is_evolved
):
    """
    **Validates: Requirements 3.4**

    For any GamePiece that has at least one GameState referencing it,
    attempting to delete that GamePiece should fail with a foreign key
    constraint error and leave the GamePiece record intact.
    """
    engine = make_engine()

    with Session(engine) as session:
        # Create an Artwork
        artwork = Artwork(image_url=image_url)
        session.add(artwork)
        session.commit()
        session.refresh(artwork)

        # Create a GamePiece referencing the artwork
        piece = GamePiece(
            artwork_id=artwork.id,
            name=piece_name,
            element=element,
            base_hp=base_hp,
            base_atk=base_atk,
        )
        session.add(piece)
        session.commit()
        session.refresh(piece)
        piece_id = piece.id

        # Create a GameState referencing the GamePiece
        game_state = GameState(
            piece_id=piece_id,
            current_hp=current_hp,
            is_evolved=is_evolved,
        )
        session.add(game_state)
        session.commit()

    # Attempt to delete the GamePiece in a new session — must raise IntegrityError
    with Session(engine) as session:
        piece_to_delete = session.get(GamePiece, piece_id)
        assert piece_to_delete is not None

        with pytest.raises(IntegrityError):
            session.delete(piece_to_delete)
            session.commit()

        session.rollback()

    # Verify the GamePiece still exists after the failed deletion
    with Session(engine) as session:
        still_exists = session.get(GamePiece, piece_id)
        assert still_exists is not None, (
            f"GamePiece {piece_id} should still exist after failed deletion"
        )

    SQLModel.metadata.drop_all(engine)
    engine.dispose()
