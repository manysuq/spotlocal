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
    result["top_tracks"] = []
    result["online_albums"] = []
    artist_id = artist_data.get("id")

    # 1. Fetch artist tracks (combining top charts and ranked catalog search)
    try:
        raw_tracks = []
        seen_keys = set()

        # 1a. Artist top charts
        try:
            top_url = f"https://api.deezer.com/artist/{artist_id}/top?limit=50"
            req = urllib.request.Request(top_url, headers={"User-Agent": "SpotLocal/1.0"})
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                top_json = json.loads(resp.read().decode())
                for t in top_json.get("data", []):
                    title = t.get("title_short") or t.get("title", "")
                    art = t.get("artist", {}).get("name", "")
                    key = f"{title.lower()}:{art.lower()}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        raw_tracks.append(t)
        except Exception as e:
            logger.warning(f"Error fetching top charts for {artist_name}: {e}")

        # 1b. Search query for artist ranked songs
        try:
            enc = urllib.parse.quote(artist_name.strip())
            search_url = f"https://api.deezer.com/search?q={enc}&limit=50&order=RANKING"
            req2 = urllib.request.Request(search_url, headers={"User-Agent": "SpotLocal/1.0"})
            with urllib.request.urlopen(req2, timeout=3.5) as resp2:
                s_json = json.loads(resp2.read().decode())
                for t in s_json.get("data", []):
                    art = t.get("artist", {}).get("name", "")
                    if artist_name.lower() in art.lower() or art.lower() in artist_name.lower():
                        title = t.get("title_short") or t.get("title", "")
                        key = f"{title.lower()}:{art.lower()}"
                        if key not in seen_keys:
                            seen_keys.add(key)
                            raw_tracks.append(t)
        except Exception as e:
            logger.warning(f"Error searching ranked tracks for {artist_name}: {e}")

        # Process and match with local library
        for t in raw_tracks:
            t_title = t.get("title_short") or t.get("title", "")
            t_artist = t.get("artist", {}).get("name", "")
            matched = db.get_all_tracks(search=t_title, limit=5)
            loc_id = None
            for m in matched:
                if m["title"].lower() == t_title.lower() or t_artist.lower() in m["artist"].lower() or artist_name.lower() in m["artist"].lower():
                    loc_id = m["id"]
                    break
            result["top_tracks"].append({
                "title": t_title,
                "artist": t_artist,
                "album": t.get("album", {}).get("title", ""),
                "cover": t.get("album", {}).get("cover_medium", ""),
                "duration": t.get("duration", 0),
                "preview_url": t.get("preview", ""),
                "is_local": loc_id is not None,
                "local_track_id": loc_id
            })
    except Exception as e:
        logger.warning(f"Error compiling tracks for {artist_name}: {e}")

    # 2. Fetch artist online albums
    try:
        alb_url = f"https://api.deezer.com/artist/{artist_id}/albums?limit=8"
        req = urllib.request.Request(alb_url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            alb_json = json.loads(resp.read().decode())
            for al in alb_json.get("data", []):
                result["online_albums"].append({
                    "title": al.get("title", ""),
                    "cover": al.get("cover_medium", ""),
                    "release_date": al.get("release_date", ""),
                    "fans": al.get("fans", 0)
                })
    except Exception as e:
        logger.warning(f"Error fetching online albums for {artist_name}: {e}")

    # 3. Related artists
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


def search_unified(query: str) -> Dict[str, Any]:
    """
    Performs full Spotify-grade search across local library AND online database.
    Returns:
      - top_result: matched artist or song
      - local_tracks: matching downloaded tracks
      - artists: matching artists
      - online_tracks: matching online tracks with preview and 1-click download
    """
    q = query.strip()
    if not q:
        return {"query": "", "top_result": None, "local_tracks": [], "artists": [], "online_tracks": []}

    cache_key = f"search:{q.lower()}"
    if cache_key in _cache:
        cached = _cache[cache_key]
        for t in cached.get("online_tracks", []):
            m = db.get_all_tracks(search=t["title"], limit=1)
            t["is_local"] = len(m) > 0
            t["local_track_id"] = m[0]["id"] if m else None
        return cached

    # 1. Local search
    local_tracks = db.get_all_tracks(search=q, limit=20)

    # 2. Online search
    artists_list = []
    online_tracks = []

    try:
        encoded = urllib.parse.quote(q)
        a_url = f"https://api.deezer.com/search/artist?q={encoded}&limit=10"
        req = urllib.request.Request(a_url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            a_data = json.loads(resp.read().decode())
            for a in a_data.get("data", []):
                a_name = a.get("name")
                if not a_name:
                    continue
                loc_count = len(db.get_all_tracks(artist=a_name, limit=1))
                artists_list.append({
                    "name": a_name,
                    "picture": a.get("picture_big") or a.get("picture_medium"),
                    "fans": a.get("nb_fan", 0),
                    "is_local": loc_count > 0
                })
            # Sort artists: exact name match first, then by popularity (fans)
            artists_list.sort(
                key=lambda a: (
                    2 if a["name"].lower() == q.lower() else (1 if q.lower() in a["name"].lower() else 0),
                    a.get("fans", 0)
                ),
                reverse=True
            )
    except Exception as e:
        logger.warning(f"Artist search error for '{q}': {e}")

    try:
        t_url = f"https://api.deezer.com/search?q={encoded}&limit=25&order=RANKING"
        req = urllib.request.Request(t_url, headers={"User-Agent": "SpotLocal/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            t_data = json.loads(resp.read().decode())
            for t in t_data.get("data", []):
                t_title = t.get("title_short") or t.get("title", "")
                t_artist = t.get("artist", {}).get("name", "")
                matched = db.get_all_tracks(search=t_title, limit=3)
                loc_id = None
                for m in matched:
                    if m["title"].lower() == t_title.lower() or t_artist.lower() in m["artist"].lower():
                        loc_id = m["id"]
                        break

                online_tracks.append({
                    "title": t_title,
                    "artist": t_artist,
                    "album": t.get("album", {}).get("title", ""),
                    "cover": t.get("album", {}).get("cover_medium", ""),
                    "duration": t.get("duration", 0),
                    "preview_url": t.get("preview", ""),
                    "is_local": loc_id is not None,
                    "local_track_id": loc_id
                })
    except Exception as e:
        logger.warning(f"Track search error for '{q}': {e}")

    # Determine Top Result (Spotify-style)
    top_result = None
    for a in artists_list:
        if a["name"].lower() == q.lower() or q.lower() in a["name"].lower() or a["name"].lower() in q.lower():
            top_result = {
                "type": "artist",
                "name": a["name"],
                "subtitle": "Исполнитель",
                "picture": a["picture"],
                "fans": a["fans"],
                "is_local": a["is_local"]
            }
            break

    if not top_result and local_tracks:
        top_result = {
            "type": "track",
            "name": local_tracks[0]["title"],
            "subtitle": f"Песня • {local_tracks[0]['artist']}",
            "picture": f"/api/covers/{local_tracks[0]['id']}",
            "is_local": True,
            "track_id": local_tracks[0]["id"]
        }
    elif not top_result and online_tracks:
        top_result = {
            "type": "track",
            "name": online_tracks[0]["title"],
            "subtitle": f"Песня • {online_tracks[0]['artist']}",
            "picture": online_tracks[0]["cover"],
            "is_local": online_tracks[0]["is_local"],
            "preview_url": online_tracks[0]["preview_url"]
        }

    res = {
        "query": q,
        "top_result": top_result,
        "local_tracks": local_tracks,
        "artists": artists_list,
        "online_tracks": online_tracks
    }
    _cache[cache_key] = res
    return res
