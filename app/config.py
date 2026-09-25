import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

# Data & Music Directories
MUSIC_DIR = Path(os.getenv("SPOTLOCAL_MUSIC_DIR", BASE_DIR / "music")).resolve()
DATA_DIR = Path(os.getenv("SPOTLOCAL_DATA_DIR", BASE_DIR / "data")).resolve()
COVERS_DIR = DATA_DIR / "covers"
DB_PATH = Path(os.getenv("SPOTLOCAL_DB_PATH", DATA_DIR / "spotlocal.db")).resolve()

# Server Settings
HOST = os.getenv("SPOTLOCAL_HOST", "0.0.0.0")
PORT = int(os.getenv("SPOTLOCAL_PORT", "8000"))

# spotDL Settings
SPOTDL_AUDIO_FORMAT = os.getenv("SPOTLOCAL_AUDIO_FORMAT", "mp3")
SPOTDL_OUTPUT_TEMPLATE = os.getenv(
    "SPOTLOCAL_OUTPUT_TEMPLATE", 
    "{artist} - {title}.{output-ext}"
)
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")

# Ensure essential directories exist
MUSIC_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
COVERS_DIR.mkdir(parents=True, exist_ok=True)
