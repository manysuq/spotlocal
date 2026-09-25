import os
import hashlib
import mimetypes
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from app import database as db
from app.config import COVERS_DIR
from app.downloader import resolve_online_stream_url

router = APIRouter(tags=["Stream & Media"])


def get_media_type(filepath: str) -> str:
    ext = Path(filepath).suffix.lower()
    types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg; codecs=opus",
        ".wav": "audio/wav",
        ".aac": "audio/aac",
    }
    return types.get(ext, "application/octet-stream")


def send_bytes_range_requests(
    file_path: Path,
    range_header: Optional[str],
    media_type: str
):
    """
    Handles HTTP Range requests for streaming audio files.
    Enables instant audio seeking and smooth scrubbing on mobile & desktop browsers.
    """
    file_size = file_path.stat().st_size
    
    if not range_header:
        def iter_full():
            with open(file_path, mode="rb") as f:
                while chunk := f.read(64 * 1024):
                    yield chunk

        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": media_type
        }
        return StreamingResponse(iter_full(), headers=headers, media_type=media_type)

    try:
        # Range header format: "bytes=start-end"
        range_val = range_header.replace("bytes=", "").strip()
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1

        if start >= file_size or end >= file_size or start > end:
            return Response(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={"Content-Range": f"bytes */{file_size}"}
            )

        content_length = end - start + 1

        def iter_range():
            with open(file_path, mode="rb") as f:
                f.seek(start)
                bytes_left = content_length
                while bytes_left > 0:
                    read_len = min(64 * 1024, bytes_left)
                    chunk = f.read(read_len)
                    if not chunk:
                        break
                    bytes_left -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": media_type,
        }
        return StreamingResponse(
            iter_range(),
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            headers=headers,
            media_type=media_type
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid range request")


@router.get("/api/stream/online")
async def stream_online(q: str, request: Request, artist: Optional[str] = None, title: Optional[str] = None):
    """
    Streams full-length song audio directly for any online track (not 30-sec snippets).
    If locally downloaded, streams from disk with byte-range seeking.
    If online, resolves direct stream URL from YouTube Music/YouTube.
    """
    # 1. Check local library
    search_term = title or q
    if search_term:
        matches = db.get_all_tracks(search=search_term, limit=5)
        for m in matches:
            if not artist or artist.lower() in m["artist"].lower() or m["artist"].lower() in artist.lower():
                file_path = Path(m["filepath"])
                if file_path.is_file():
                    media_type = get_media_type(str(file_path))
                    return send_bytes_range_requests(file_path, request.headers.get("Range"), media_type)

    # 2. Resolve full-length online audio stream
    search_q = f"{artist} - {title}" if (artist and title) else q
    stream_url = await resolve_online_stream_url(search_q)
    if stream_url:
        return RedirectResponse(url=stream_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    raise HTTPException(status_code=404, detail="Audio stream not found")


@router.get("/api/stream/{track_id}")
async def stream_track(track_id: int, request: Request):
    track = db.get_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    file_path = Path(track["filepath"])
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    media_type = get_media_type(str(file_path))
    range_header = request.headers.get("Range")
    return send_bytes_range_requests(file_path, range_header, media_type)


@router.get("/api/covers/{track_id}")
async def get_cover(track_id: int):
    track = db.get_track_by_id(track_id)
    if not track:
        return default_cover_response()

    file_path = Path(track["filepath"])
    cover_hash = hashlib.md5(str(file_path.resolve()).encode("utf-8")).hexdigest()
    cover_ext = track.get("cover_ext", "jpg")
    cover_file = COVERS_DIR / f"{cover_hash}.{cover_ext}"

    if cover_file.is_file():
        media_type = "image/png" if cover_ext == "png" else "image/jpeg"
        return FileResponse(cover_file, media_type=media_type)

    return default_cover_response()


def default_cover_response():
    """Returns a sleek SVG placeholder when no cover image is available."""
    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#282828;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#121212;stop-opacity:1" />
            </linearGradient>
        </defs>
        <rect width="300" height="300" fill="url(#grad)" rx="8"/>
        <circle cx="150" cy="150" r="80" fill="#181818" stroke="#333" stroke-width="2"/>
        <circle cx="150" cy="150" r="28" fill="#121212"/>
        <path d="M142 125v50l32-25z" fill="#1db954"/>
    </svg>"""
    return Response(content=svg_content, media_type="image/svg+xml")
