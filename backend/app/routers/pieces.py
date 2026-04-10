from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.models import Artwork, GamePiece
from app.schemas import GamePieceCreate, GamePieceResponse, ArtworkResponse

router = APIRouter(prefix="/pieces", tags=["pieces"])


def get_session():
    from app.main import engine
    with Session(engine) as session:
        yield session


@router.post("", response_model=GamePieceResponse, status_code=status.HTTP_201_CREATED)
def create_piece(piece_in: GamePieceCreate, session: Session = Depends(get_session)):
    artwork = session.get(Artwork, piece_in.artwork_id)
    if not artwork:
        raise HTTPException(status_code=404, detail="Artwork not found")

    piece = GamePiece(
        artwork_id=piece_in.artwork_id,
        name=piece_in.name,
        element=piece_in.element,
        base_hp=piece_in.base_hp,
        base_atk=piece_in.base_atk,
    )
    session.add(piece)
    session.commit()
    session.refresh(piece)

    return GamePieceResponse(
        id=piece.id,
        artwork_id=piece.artwork_id,
        name=piece.name,
        element=piece.element,
        base_hp=piece.base_hp,
        base_atk=piece.base_atk,
        artwork=ArtworkResponse.model_validate(artwork),
    )


@router.get("", response_model=List[GamePieceResponse], status_code=status.HTTP_200_OK)
def list_pieces(session: Session = Depends(get_session)):
    pieces = session.exec(select(GamePiece)).all()
    result = []
    for piece in pieces:
        artwork = session.get(Artwork, piece.artwork_id)
        result.append(
            GamePieceResponse(
                id=piece.id,
                artwork_id=piece.artwork_id,
                name=piece.name,
                element=piece.element,
                base_hp=piece.base_hp,
                base_atk=piece.base_atk,
                artwork=ArtworkResponse.model_validate(artwork),
            )
        )
    return result
