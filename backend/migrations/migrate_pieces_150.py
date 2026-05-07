"""
Migration: set all existing pieces to base_hp=100, base_atk=50.

Run with: python migrations/migrate_pieces_150.py
"""
import sys
import os

# Add parent dir to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select
from app.models import GamePiece
from app.main import engine


def main():
    with Session(engine) as session:
        pieces = session.exec(select(GamePiece)).all()
        count = len(pieces)
        for piece in pieces:
            piece.base_hp = 100
            piece.base_atk = 50
        session.commit()
        print(f"✓ Updated {count} pieces: base_hp=100, base_atk=50")


if __name__ == "__main__":
    main()
