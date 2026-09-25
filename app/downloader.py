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

logger = logging.getLogger("spotlocal.downloader")

# Active download subscribers (for SSE event streaming)
_listeners: List[asyncio.Queue] = []
_active_processes: Dict[str, asyncio.subprocess.Process] = {}


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
    # Check if spotdl is in PATH
    spotdl_path = shutil.which("spotdl")
    if spotdl_path:
        return [spotdl_path]

    # Check in current virtual environment bin directory
    venv_spotdl = os.path.join(os.path.dirname(sys.executable), "spotdl")
    if os.path.isfile(venv_spotdl):
        return [venv_spotdl]

    # Fallback to python module execution
    return [sys.executable, "-m", "spotdl"]


async def run_spotdl_job(job_id: str, query: str):
    """
    Executes spotdl download process in the background, captures stdout/stderr,
    updates database state, broadcasts SSE logs, and triggers a library rescan.
    """
    logger.info(f"Starting download job {job_id}: {query}")
    update_download_job(job_id, status="running", progress="Starting spotDL...")
    await broadcast_event("job_started", {"job_id": job_id, "query": query})

    cmd = find_spotdl_binary() + [
        query,
        "--output", SPOTDL_OUTPUT_TEMPLATE,
        "--format", SPOTDL_AUDIO_FORMAT,
        "--print-errors",
    ]

    env = os.environ.copy()
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
