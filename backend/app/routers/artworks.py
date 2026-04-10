from typing import List

from fastapi import APIRouter, Depends, status
from sqlmodel import Session, select

from app.models import Artwork
from app.schemas import ArtworkCreate, ArtworkResponse

router = APIRouter(prefix="/artworks", tags=["artworks"])


def get_session():
    from app.main import engine
    with Session(engine) as session:
        yield session


@router.post("", response_model=ArtworkResponse, status_code=status.HTTP_201_CREATED)
def create_artwork(artwork_in: ArtworkCreate, session: Session = Depends(get_session)):
    artwork = Artwork(
        image_url=artwork_in.image_url,
        prompt=artwork_in.prompt,
        seed=artwork_in.seed,
    )
    session.add(artwork)
    session.commit()
    session.refresh(artwork)
    return artwork


@router.get("", response_model=List[ArtworkResponse], status_code=status.HTTP_200_OK)
def list_artworks(session: Session = Depends(get_session)):
    artworks = session.exec(select(Artwork)).all()
    return artworks
