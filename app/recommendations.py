import urllib.request
import urllib.parse
import json
import logging
from typing import Dict, Any, List, Optional
from app import database as db

logger = logging.getLogger("spotlocal.recommendations")

# In-memory cache for recommendations: key -> (timestamp, data)
_cache: Dict[str, Any] = {}


def _search_deezer_artist(artist_name: str) -> Optional[Dict[str, Any]]:
    try:
        encoded = urllib.parse.quote(artist_name.strip())
        url = f"https://api.deezer.com/search/artist?q={encoded}&limit=10"
        req = urllib.request.Request(url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode())
            items = data.get("data", [])
            if not items:
                return None
            return max(items, key=lambda x: x.get("nb_fan", 0))
    except Exception as e:
        logger.warning(f"Failed to search Deezer artist for '{artist_name}': {e}")
        return None


def get_artist_info_and_similar(artist_name: str) -> Dict[str, Any]:
    """
    Returns artist metadata (avatar, fans), similar artists, and radio tracks.
    Safely falls back to local data if offline or network fails.
    """
    cache_key = f"artist:{artist_name.lower().strip()}"
    if cache_key in _cache:
        return _cache[cache_key]

    # Local tracks for this artist
    local_tracks = db.get_all_tracks(artist=artist_name, limit=500)

    # Local albums for this artist
    local_albums = []
    seen_albums = set()
    for t in local_tracks:
        alb = t.get("album", "").strip()
        if alb and alb not in seen_albums:
            seen_albums.add(alb)
            local_albums.append({
                "album": alb,
                "artist": artist_name,
                "sample_track_id": t["id"],
                "has_cover": t.get("has_cover", 0)
            })

    result: Dict[str, Any] = {
        "artist": artist_name,
        "avatar_url": None,
        "fan_count": 0,
        "local_tracks": local_tracks,
        "local_albums": local_albums,
        "similar_artists": [],
        "similar_tracks": []
    }

    # Fetch from Deezer
    artist_data = _search_deezer_artist(artist_name)
    if not artist_data:
        _cache[cache_key] = result
        return result

    result["avatar_url"] = (
        artist_data.get("picture_xl") or
        artist_data.get("picture_big") or
        artist_data.get("picture_medium")
    )
    result["fan_count"] = artist_data.get("nb_fan", 0)
    artist_id = artist_data.get("id")

    # 1. Related artists
    try:
        rel_url = f"https://api.deezer.com/artist/{artist_id}/related?limit=8"
        req = urllib.request.Request(rel_url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            rel_json = json.loads(resp.read().decode())
            rel_items = rel_json.get("data", [])
            for a in rel_items:
                name = a.get("name")
                if not name:
                    continue
                # Check if we have this artist locally
                local_count = len(db.get_all_tracks(artist=name, limit=1))
                result["similar_artists"].append({
                    "name": name,
                    "picture": a.get("picture_medium") or a.get("picture_big"),
                    "fans": a.get("nb_fan", 0),
                    "is_in_library": local_count > 0
                })
    except Exception as e:
        logger.warning(f"Error fetching related artists for {artist_name}: {e}")

    # 2. Artist radio / similar tracks
    try:
        radio_url = f"https://api.deezer.com/artist/{artist_id}/radio?limit=15"
        req = urllib.request.Request(radio_url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            radio_json = json.loads(resp.read().decode())
            for t in radio_json.get("data", []):
                t_title = t.get("title_short") or t.get("title", "")
                t_artist = t.get("artist", {}).get("name", "")
                
                # Check if this track is already in local database
                matched = db.get_all_tracks(search=t_title, limit=5)
                local_id = None
                for m in matched:
                    if m["title"].lower() == t_title.lower() or (t_artist.lower() in m["artist"].lower()):
                        local_id = m["id"]
                        break

                result["similar_tracks"].append({
                    "title": t_title,
                    "artist": t_artist,
                    "album": t.get("album", {}).get("title", ""),
                    "cover": t.get("album", {}).get("cover_medium", ""),
                    "duration": t.get("duration", 0),
                    "preview_url": t.get("preview", ""),
                    "is_local": local_id is not None,
                    "local_track_id": local_id
                })
    except Exception as e:
        logger.warning(f"Error fetching radio tracks for {artist_name}: {e}")

    _cache[cache_key] = result
    return result


def get_track_recommendations(track_id: int) -> Dict[str, Any]:
    """
    Returns recommendations and similar tracks based on a given seed track.
    Combines local library tracks with external similar recommendations.
    """
    seed_track = db.get_track_by_id(track_id)
    if not seed_track:
        return {"seed_track": None, "local_similar": [], "similar_tracks": []}

    artist_name = seed_track.get("artist", "")
    genre = seed_track.get("genre", "")

    # Local similar: same artist or same genre, excluding seed
    all_same_artist = db.get_all_tracks(artist=artist_name, limit=10)
    local_similar = [t for t in all_same_artist if t["id"] != track_id]

    # Get artist recommendations
    artist_rec = get_artist_info_and_similar(artist_name)

    return {
        "seed_track": seed_track,
        "local_similar": local_similar,
        "similar_artists": artist_rec.get("similar_artists", []),
        "similar_tracks": artist_rec.get("similar_tracks", [])
    }
