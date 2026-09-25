FROM python:3.11-slim

# Install system dependencies (ffmpeg is required for spotDL audio conversion)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency requirements
COPY requirements.txt .

# Install Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY app/ ./app/

# Create persistent storage directories
RUN mkdir -p /app/music /app/data/covers

# Environment settings
ENV PYTHONUNBUFFERED=1
ENV SPOTLOCAL_HOST=0.0.0.0
ENV SPOTLOCAL_PORT=8000
ENV SPOTLOCAL_MUSIC_DIR=/app/music
ENV SPOTLOCAL_DATA_DIR=/app/data

EXPOSE 8000

VOLUME ["/app/music", "/app/data"]

CMD ["python", "-m", "app.main"]
