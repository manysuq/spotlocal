import sqlite3
import logging
from contextlib import contextmanager
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.config import DB_PATH

logger = logging.getLogger("spotlocal.db")


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        conn.close()


def init_db():
    """Initializes tables and indexes."""
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            year TEXT DEFAULT '',
            genre TEXT DEFAULT '',
            track_num INTEGER DEFAULT 0,
            duration REAL DEFAULT 0.0,
            filesize INTEGER DEFAULT 0,
            has_cover INTEGER DEFAULT 0,
            cover_ext TEXT DEFAULT 'jpg',
            play_count INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            mtime REAL DEFAULT 0.0
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
        CREATE INDEX IF NOT EXISTS idx_tracks_fav ON tracks(is_favorite);

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS download_jobs (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            progress TEXT DEFAULT '',
            error_message TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        logger.info("Database initialized successfully.")


# Track operations
def get_all_tracks(
    search: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    favorites_only: bool = False,
    sort_by: str = "added_at",
    order: str = "DESC",
    limit: int = 1000,
    offset: int = 0
) -> List[Dict[str, Any]]:
    with get_db() as conn:
        query = "SELECT * FROM tracks WHERE 1=1"
        params: List[Any] = []

        if search:
            query += " AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)"
            s_param = f"%{search}%"
            params.extend([s_param, s_param, s_param])
        if artist:
            query += " AND artist = ?"
            params.append(artist)
        if album:
            query += " AND album = ?"
            params.append(album)
        if favorites_only:
            query += " AND is_favorite = 1"

        valid_sorts = {
            "title": "title COLLATE NOCASE",
            "artist": "artist COLLATE NOCASE",
            "album": "album COLLATE NOCASE",
            "duration": "duration",
            "added_at": "added_at",
            "play_count": "play_count"
        }
        sort_col = valid_sorts.get(sort_by, "added_at")
        order_dir = "ASC" if order.upper() == "ASC" else "DESC"
        query += f" ORDER BY {sort_col} {order_dir} LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def get_track_by_id(track_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def toggle_favorite(track_id: int) -> Optional[bool]:
    with get_db() as conn:
        cursor = conn.execute("SELECT is_favorite FROM tracks WHERE id = ?", (track_id,))
        row = cursor.fetchone()
        if not row:
            return None
        new_val = 0 if row["is_favorite"] else 1
        conn.execute("UPDATE tracks SET is_favorite = ? WHERE id = ?", (new_val, track_id))
        return bool(new_val)


def increment_play_count(track_id: int):
    with get_db() as conn:
        conn.execute("UPDATE tracks SET play_count = play_count + 1 WHERE id = ?", (track_id,))


def upsert_track(track_data: Dict[str, Any]) -> int:
    with get_db() as conn:
        cursor = conn.execute("""
            INSERT INTO tracks (
                filepath, filename, title, artist, album, year, genre,
                track_num, duration, filesize, has_cover, cover_ext, mtime
            ) VALUES (
                :filepath, :filename, :title, :artist, :album, :year, :genre,
                :track_num, :duration, :filesize, :has_cover, :cover_ext, :mtime
            )
            ON CONFLICT(filepath) DO UPDATE SET
                filename = excluded.filename,
                title = excluded.title,
                artist = excluded.artist,
                album = excluded.album,
                year = excluded.year,
                genre = excluded.genre,
                track_num = excluded.track_num,
                duration = excluded.duration,
                filesize = excluded.filesize,
                has_cover = excluded.has_cover,
                cover_ext = excluded.cover_ext,
                mtime = excluded.mtime
            RETURNING id;
        """, track_data)
        row = cursor.fetchone()
        return row[0] if row else 0


def delete_missing_tracks(existing_filepaths: set) -> int:
    with get_db() as conn:
        cursor = conn.execute("SELECT id, filepath FROM tracks")
        all_tracks = cursor.fetchall()
        to_delete = [t["id"] for t in all_tracks if t["filepath"] not in existing_filepaths]
        if to_delete:
            conn.executemany("DELETE FROM tracks WHERE id = ?", [(tid,) for tid in to_delete])
        return len(to_delete)


# Artist & Album Aggregates
def get_artists() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("""
            SELECT artist, COUNT(*) as track_count, SUM(duration) as total_duration
            FROM tracks
            WHERE artist != ''
            GROUP BY artist
            ORDER BY artist COLLATE NOCASE ASC
        """)
        return [dict(row) for row in cursor.fetchall()]


def get_albums() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("""
            SELECT album, artist, COUNT(*) as track_count, 
                   MAX(has_cover) as has_cover, MIN(id) as sample_track_id,
                   SUM(duration) as total_duration
            FROM tracks
            WHERE album != ''
            GROUP BY album, artist
            ORDER BY album COLLATE NOCASE ASC
        """)
        return [dict(row) for row in cursor.fetchall()]


# Playlist operations
def get_playlists() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("""
            SELECT p.*, COUNT(pt.track_id) as track_count,
                   (SELECT MIN(t.id) FROM playlist_tracks pt2 
                    JOIN tracks t ON pt2.track_id = t.id 
                    WHERE pt2.playlist_id = p.id AND t.has_cover = 1) as cover_track_id
            FROM playlists p
            LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
            GROUP BY p.id
            ORDER BY p.name COLLATE NOCASE ASC
        """)
        return [dict(row) for row in cursor.fetchall()]


def create_playlist(name: str, description: str = "") -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO playlists (name, description) VALUES (?, ?) RETURNING id, name, description, created_at",
            (name.strip(), description.strip())
        )
        row = cursor.fetchone()
        return dict(row)


def delete_playlist(playlist_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        return cursor.rowcount > 0


def get_playlist_tracks(playlist_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
        p_row = cursor.fetchone()
        if not p_row:
            return None
        
        t_cursor = conn.execute("""
            SELECT t.*, pt.position
            FROM playlist_tracks pt
            JOIN tracks t ON pt.track_id = t.id
            WHERE pt.playlist_id = ?
            ORDER BY pt.position ASC
        """, (playlist_id,))
        tracks = [dict(r) for r in t_cursor.fetchall()]
        res = dict(p_row)
        res["tracks"] = tracks
        res["track_count"] = len(tracks)
        return res


def add_track_to_playlist(playlist_id: int, track_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,)
        )
        pos = cursor.fetchone()[0]
        try:
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                (playlist_id, track_id, pos)
            )
            return True
        except sqlite3.IntegrityError:
            return False


def remove_track_from_playlist(playlist_id: int, track_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
            (playlist_id, track_id)
        )
        return cursor.rowcount > 0


# Download job operations
def create_download_job(job_id: str, query: str) -> Dict[str, Any]:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO download_jobs (id, query, status) VALUES (?, ?, 'queued')",
            (job_id, query)
        )
        return {"id": job_id, "query": query, "status": "queued"}


def update_download_job(
    job_id: str,
    status: str,
    progress: Optional[str] = None,
    error_message: Optional[str] = None
):
    with get_db() as conn:
        query = "UPDATE download_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP"
        params = [status]
        if progress is not None:
            query += ", progress = ?"
            params.append(progress)
        if error_message is not None:
            query += ", error_message = ?"
            params.append(error_message)
        query += " WHERE id = ?"
        params.append(job_id)
        conn.execute(query, params)


def get_download_jobs(limit: int = 50) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM download_jobs ORDER BY created_at DESC LIMIT ?",
            (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]


def get_stats() -> Dict[str, Any]:
    with get_db() as conn:
        t_count = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        a_count = conn.execute("SELECT COUNT(DISTINCT artist) FROM tracks WHERE artist != ''").fetchone()[0]
        al_count = conn.execute("SELECT COUNT(DISTINCT album) FROM tracks WHERE album != ''").fetchone()[0]
        p_count = conn.execute("SELECT COUNT(*) FROM playlists").fetchone()[0]
        total_sec = conn.execute("SELECT COALESCE(SUM(duration), 0) FROM tracks").fetchone()[0]
        return {
            "total_tracks": t_count,
            "total_artists": a_count,
            "total_albums": al_count,
            "total_playlists": p_count,
            "total_duration": total_sec
        }
