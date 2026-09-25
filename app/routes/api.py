from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app import database as db
from app.scanner import scan_library

router = APIRouter(prefix="/api", tags=["API"])


class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = ""


class AddTrackRequest(BaseModel):
    track_id: int


# Tracks Endpoints
@router.get("/tracks")
def get_tracks(
    search: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    favorites: bool = False,
    sort_by: str = "added_at",
    order: str = "DESC",
    limit: int = 500,
    offset: int = 0
):
    return db.get_all_tracks(
        search=search,
        artist=artist,
        album=album,
        favorites_only=favorites,
        sort_by=sort_by,
        order=order,
        limit=limit,
        offset=offset
    )


@router.get("/tracks/{track_id}")
def get_track(track_id: int):
    track = db.get_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.post("/tracks/{track_id}/favorite")
def toggle_favorite(track_id: int):
    new_fav = db.toggle_favorite(track_id)
    if new_fav is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"track_id": track_id, "is_favorite": new_fav}


@router.post("/tracks/{track_id}/play")
def record_play(track_id: int):
    db.increment_play_count(track_id)
    return {"status": "ok"}


# Artists & Albums Endpoints
@router.get("/artists")
def get_artists():
    return db.get_artists()


@router.get("/albums")
def get_albums():
    return db.get_albums()


# Playlists Endpoints
@router.get("/playlists")
def get_playlists():
    return db.get_playlists()


@router.post("/playlists")
def create_playlist(payload: PlaylistCreate):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Playlist name is required")
    return db.create_playlist(payload.name, payload.description or "")


@router.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: int):
    pl = db.get_playlist_tracks(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl


@router.delete("/playlists/{playlist_id}")
def delete_playlist(playlist_id: int):
    success = db.delete_playlist(playlist_id)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"status": "deleted"}


@router.post("/playlists/{playlist_id}/tracks")
def add_to_playlist(playlist_id: int, payload: AddTrackRequest):
    success = db.add_track_to_playlist(playlist_id, payload.track_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to add track or already present")
    return {"status": "added"}


@router.delete("/playlists/{playlist_id}/tracks/{track_id}")
def remove_from_playlist(playlist_id: int, track_id: int):
    success = db.remove_track_from_playlist(playlist_id, track_id)
    if not success:
        raise HTTPException(status_code=404, detail="Track not in playlist")
    return {"status": "removed"}


# Library Endpoints
@router.post("/library/rescan")
def rescan_library():
    stats = scan_library()
    return {"status": "ok", "result": stats}


@router.get("/library/stats")
def library_stats():
    return db.get_stats()
