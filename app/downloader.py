import os
import sys
import uuid
import asyncio
import logging
import shutil
from typing import Dict, Any, List, AsyncGenerator
from app.config import (
    MUSIC_DIR, 
    SPOTDL_AUDIO_FORMAT, 
    SPOTDL_OUTPUT_TEMPLATE,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET
)
from app.database import create_download_job, update_download_job, get_download_jobs
from app.scanner import scan_library

import re
import time

logger = logging.getLogger("spotlocal.downloader")

# Active download subscribers (for SSE event streaming)
_listeners: List[asyncio.Queue] = []
_active_processes: Dict[str, asyncio.subprocess.Process] = {}
_stream_url_cache: Dict[str, Any] = {}


def clean_query(q: str) -> str:
    """Sanitizes search query to prevent quote and symbol issues in Spotify/YouTube matching."""
    if q.startswith("http://") or q.startswith("https://"):
        return q.strip()
    cleaned = re.sub(r'[«»""\'\(\)\[\]]', ' ', q)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


async def resolve_online_stream_url(query: str, force_refresh: bool = False) -> Optional[str]:
    """
    Resolves a direct full-length audio stream URL via yt-dlp.
    Caches stream URLs in-memory to ensure instantaneous repeat playback.
    """
    sanitized = clean_query(query)
    cache_key = sanitized.lower()
    now = time.time()
    if not force_refresh and cache_key in _stream_url_cache:
        t, u = _stream_url_cache[cache_key]
        if now - t < 7200:
            return u

    cmd = [
        "yt-dlp",
        "--no-playlist",
        "-g",
        "-f", "ba[ext=m4a]/ba/bestaudio",
        f"ytsearch1:{sanitized}"
    ]
    env = os.environ.copy()
    env["PATH"] = f"/usr/local/bin:/usr/bin:/bin:{env.get('PATH', '')}"
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=12.0)
        if proc.returncode == 0 and stdout:
            lines = stdout.decode().strip().split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("http"):
                    _stream_url_cache[cache_key] = (now, line)
                    return line
        else:
            err_msg = stderr.decode(errors="replace") if stderr else f"returncode {proc.returncode}"
            logger.warning(f"yt-dlp stream resolution failed for '{query}': {err_msg}")
    except Exception as e:
        logger.warning(f"Error resolving full stream URL for '{query}': {e}")

    return None


async def broadcast_event(event_type: str, data: Dict[str, Any]):
    """Broadcast an event to all connected SSE clients."""
    payload = {"event": event_type, "data": data}
    for queue in list(_listeners):
        try:
            await queue.put(payload)
        except Exception:
            _listeners.remove(queue)


def register_listener() -> asyncio.Queue:
    queue = asyncio.Queue(maxsize=100)
    _listeners.append(queue)
    return queue


def unregister_listener(queue: asyncio.Queue):
    if queue in _listeners:
        _listeners.remove(queue)


def find_spotdl_binary() -> List[str]:
    """Finds spotdl executable or python module command."""
    spotdl_path = shutil.which("spotdl")
    if spotdl_path:
        return [spotdl_path]

    venv_spotdl = os.path.join(os.path.dirname(sys.executable), "spotdl")
    if os.path.isfile(venv_spotdl):
        return [venv_spotdl]

    return [sys.executable, "-m", "spotdl"]


def build_download_cmd(query: str, sanitized: str) -> List[str]:
    """
    Builds the fastest, highest-quality download command.
    Uses direct yt-dlp with YouTube Music/YouTube for instant (2-3s) full MP3 downloads.
    Falls back to spotdl if a Spotify track/album link is provided.
    """
    is_spotify = "open.spotify.com" in query.lower() or query.lower().startswith("spotify:")
    if is_spotify:
        return find_spotdl_binary() + [
            query.strip(),
            "--output", SPOTDL_OUTPUT_TEMPLATE,
            "--format", SPOTDL_AUDIO_FORMAT,
            "--audio", "youtube-music", "youtube",
            "--print-errors",
        ]

    if query.startswith("http://") or query.startswith("https://"):
        target = query.strip()
        out_tmpl = "%(artist,creator,uploader)s - %(title)s.%(ext)s"
    else:
        target = f"ytsearch1:{sanitized}"
        if " - " in sanitized:
            safe_name = re.sub(r'[/\\:\*?"<>\|]', '_', sanitized)
            out_tmpl = f"{safe_name}.%(ext)s"
        else:
            out_tmpl = "%(artist,creator,uploader)s - %(title)s.%(ext)s"

    return [
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--embed-thumbnail",
        "--embed-metadata",
        "--no-playlist",
        "--output", out_tmpl,
        target
    ]


async def run_spotdl_job(job_id: str, query: str):
    """
    Executes download process in background, captures stdout/stderr,
    updates database state, broadcasts SSE logs, and triggers a library rescan.
    """
    sanitized = clean_query(query)
    cmd = build_download_cmd(query, sanitized)
    is_ytdlp = cmd[0] == "yt-dlp"
    engine_name = "YouTube Music" if is_ytdlp else "spotDL"

    logger.info(f"Starting download job {job_id} using {engine_name}: {sanitized}")
    update_download_job(job_id, status="running", progress=f"Downloading via {engine_name}...")
    await broadcast_event("job_started", {"job_id": job_id, "query": sanitized, "engine": engine_name})

    env = os.environ.copy()
    env["PATH"] = f"/usr/local/bin:/usr/bin:/bin:{env.get('PATH', '')}"
    if SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET:
        env["SPOTIFY_CLIENT_ID"] = SPOTIFY_CLIENT_ID
        env["SPOTIFY_CLIENT_SECRET"] = SPOTIFY_CLIENT_SECRET

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(MUSIC_DIR),
            env=env
        )
        _active_processes[job_id] = process

        full_output = []
        last_progress_line = "Downloading..."

        while True:
            line = await process.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                full_output.append(text)
                last_progress_line = text[:150]
                await broadcast_event("job_log", {
                    "job_id": job_id,
                    "line": text
                })

        return_code = await process.wait()

        if return_code == 0:
            logger.info(f"Job {job_id} succeeded.")
            update_download_job(job_id, status="completed", progress="Completed successfully")
            
            # Rescan library to index new tracks
            scan_res = scan_library()
            await broadcast_event("job_completed", {
                "job_id": job_id,
                "scan_result": scan_res
            })
        else:
            err_msg = f"spotDL exited with code {return_code}"
            logger.warning(f"Job {job_id} failed: {err_msg}")
            update_download_job(job_id, status="error", error_message=err_msg)
            await broadcast_event("job_error", {
                "job_id": job_id,
                "error": err_msg
            })

    except Exception as e:
        logger.exception(f"Exception during job {job_id}: {e}")
        update_download_job(job_id, status="error", error_message=str(e))
        await broadcast_event("job_error", {
            "job_id": job_id,
            "error": str(e)
        })
    finally:
        _active_processes.pop(job_id, None)


def queue_download(query: str) -> Dict[str, Any]:
    """Creates a new download job and launches it in background asyncio task."""
    job_id = str(uuid.uuid4())[:8]
    job = create_download_job(job_id, query.strip())
    asyncio.create_task(run_spotdl_job(job_id, query.strip()))
    return job
