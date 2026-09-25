import os
import hashlib
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Set
from app.config import MUSIC_DIR, COVERS_DIR
from app.database import upsert_track, delete_missing_tracks

logger = logging.getLogger("spotlocal.scanner")

SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav", ".aac"}

try:
    import mutagen
    from mutagen.easyid3 import EasyID3
    from mutagen.id3 import ID3, APIC
    from mutagen.mp4 import MP4Cover
    from mutagen.flac import Picture
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    logger.warning("Mutagen is not installed. Falling back to filename metadata extraction.")


def extract_cover_art(audio_obj, file_path: Path) -> Optional[str]:
    """
    Extracts embedded cover art from audio tags and saves it to the covers directory.
    Returns cover file extension if found, else None.
    """
    try:
        data = None
        ext = "jpg"

        # Check for mutagen ID3 APIC (MP3)
        if hasattr(audio_obj, "tags") and audio_obj.tags:
            for key in audio_obj.tags.keys():
                if key.startswith("APIC:"):
                    apic = audio_obj.tags[key]
                    data = apic.data
                    if "png" in apic.mime.lower():
                        ext = "png"
                    break

        # Check for FLAC pictures
        if not data and hasattr(audio_obj, "pictures") and audio_obj.pictures:
            pic = audio_obj.pictures[0]
            data = pic.data
            if "png" in getattr(pic, "mime", "").lower():
                ext = "png"

        # Check for MP4 / M4A cover
        if not data and hasattr(audio_obj, "tags") and audio_obj.tags and "covr" in audio_obj.tags:
            covers = audio_obj.tags["covr"]
            if covers:
                data = covers[0]
                if getattr(covers[0], "imageformat", None) == MP4Cover.FORMAT_PNG:
                    ext = "png"

        # Check for folder cover image (cover.jpg, folder.jpg) in same dir
        if not data:
            parent = file_path.parent
            for cand in ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "album.jpg"]:
                cand_path = parent / cand
                if cand_path.is_file():
                    with open(cand_path, "rb") as f:
                        data = f.read()
                    ext = cand_path.suffix.lstrip(".").lower()
                    break

        if data:
            cover_hash = hashlib.md5(str(file_path.resolve()).encode("utf-8")).hexdigest()
            cover_file = COVERS_DIR / f"{cover_hash}.{ext}"
            with open(cover_file, "wb") as f:
                f.write(data)
            return ext
    except Exception as e:
        logger.debug(f"Failed to extract cover for {file_path.name}: {e}")
    return None


def parse_metadata(file_path: Path) -> Dict[str, Any]:
    """
    Parses audio file metadata using Mutagen or filename fallback.
    """
    stat = file_path.stat()
    mtime = stat.st_mtime
    filesize = stat.st_size

    # Defaults from filename
    stem = file_path.stem
    artist = "Unknown Artist"
    title = stem
    album = "Unknown Album"
    year = ""
    genre = ""
    track_num = 0
    duration = 0.0
    has_cover = 0
    cover_ext = "jpg"

    # Try parsing "Artist - Title" from filename
    if " - " in stem:
        parts = stem.split(" - ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()

    if MUTAGEN_AVAILABLE:
        try:
            audio = mutagen.File(str(file_path))
            if audio is not None:
                if hasattr(audio, "info") and hasattr(audio.info, "length"):
                    duration = round(float(audio.info.length), 2)

                tags = audio.tags
                if tags:
                    def get_tag(keys):
                        for k in keys:
                            if k in tags:
                                val = tags[k]
                                if isinstance(val, list) and val:
                                    return str(val[0])
                                elif hasattr(val, "text") and val.text:
                                    return str(val.text[0])
                                return str(val)
                        return None

                    t_title = get_tag(["TIT2", "title", "\xa9nam"])
                    t_artist = get_tag(["TPE1", "artist", "\xa9ART"])
                    t_album = get_tag(["TALB", "album", "\xa9alb"])
                    t_year = get_tag(["TDRC", "date", "\xa9day", "TYER"])
                    t_genre = get_tag(["TCON", "genre", "\xa9gen"])
                    t_trkn = get_tag(["TRCK", "tracknumber", "trkn"])

                    if t_title:
                        title = t_title.strip()
                    if t_artist:
                        artist = t_artist.strip()
                    if t_album:
                        album = t_album.strip()
                    if t_year:
                        year = str(t_year).strip()[:4]
                    if t_genre:
                        genre = t_genre.strip()
                    if t_trkn:
                        try:
                            # Might be "3/12"
                            track_num = int(str(t_trkn).split("/")[0])
                        except Exception:
                            pass

                # Cover extraction
                c_ext = extract_cover_art(audio, file_path)
                if c_ext:
                    has_cover = 1
                    cover_ext = c_ext
        except Exception as e:
            logger.warning(f"Error reading tags for {file_path.name}: {e}")

    return {
        "filepath": str(file_path.resolve()),
        "filename": file_path.name,
        "title": title,
        "artist": artist,
        "album": album,
        "year": year,
        "genre": genre,
        "track_num": track_num,
        "duration": duration,
        "filesize": filesize,
        "has_cover": has_cover,
        "cover_ext": cover_ext,
        "mtime": mtime
    }


def scan_library() -> Dict[str, int]:
    """
    Scans the music directory for audio files and updates the database.
    """
    if not MUSIC_DIR.exists():
        MUSIC_DIR.mkdir(parents=True, exist_ok=True)
        return {"scanned": 0, "added": 0, "removed": 0}

    scanned_paths: Set[str] = set()
    added_or_updated = 0

    for root, _, files in os.walk(MUSIC_DIR):
        for f in files:
            path = Path(root) / f
            if path.suffix.lower() in SUPPORTED_EXTENSIONS:
                scanned_paths.add(str(path.resolve()))
                meta = parse_metadata(path)
                upsert_track(meta)
                added_or_updated += 1

    removed = delete_missing_tracks(scanned_paths)
    logger.info(f"Scan complete: {len(scanned_paths)} files found, {added_or_updated} indexed, {removed} removed.")

    return {
        "scanned": len(scanned_paths),
        "indexed": added_or_updated,
        "removed": removed
    }
