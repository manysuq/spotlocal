import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from app.config import STATIC_DIR, HOST, PORT
from app.database import init_db
from app.scanner import scan_library
from app.routes.api import router as api_router
from app.routes.stream import router as stream_router
from app.routes.download import router as download_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("spotlocal")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database schema and run initial music scan
    logger.info("Initializing database...")
    init_db()
    logger.info("Scanning music directory...")
    stats = scan_library()
    logger.info(f"Initial scan completed: {stats}")
    yield
    # Shutdown logic if any
    logger.info("SpotLocal shutting down.")


app = FastAPI(
    title="SpotLocal",
    description="Self-hosted local Spotify streaming web app with spotDL integration",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(api_router)
app.include_router(stream_router)
app.include_router(download_router)

# Mount static directory for JS, CSS, icons, manifest
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root():
    """Serves the main Spotify-like single-page web app."""
    return FileResponse(
        STATIC_DIR / "index.html", 
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@app.get("/manifest.json")
async def manifest():
    """PWA Web App Manifest."""
    return FileResponse(
        STATIC_DIR / "manifest.json", 
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@app.get("/sw.js")
async def service_worker():
    """PWA Service Worker."""
    return FileResponse(
        STATIC_DIR / "sw.js", 
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
