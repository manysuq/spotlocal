import json
import asyncio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.downloader import (
    queue_download,
    get_download_jobs,
    register_listener,
    unregister_listener
)

router = APIRouter(prefix="/api/download", tags=["Downloader"])


class DownloadRequest(BaseModel):
    query: str


@router.post("")
def trigger_download(payload: DownloadRequest):
    q = payload.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query or URL cannot be empty")
    job = queue_download(q)
    return job


@router.get("/status")
def download_status():
    return get_download_jobs()


@router.get("/events")
async def download_events(request: Request):
    """
    Server-Sent Events (SSE) endpoint providing real-time log and status
    streaming for ongoing spotDL downloads.
    """
    queue = register_listener()

    async def event_generator():
        try:
            while True:
                # Disconnect check
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: {payload['event']}\ndata: {json.dumps(payload['data'])}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat comment
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unregister_listener(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
