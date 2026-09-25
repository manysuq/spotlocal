#!/usr/bin/env bash
set -e

# Change to script directory
cd "$(dirname "$0")"

echo "=== Starting SpotLocal ==="

# Check virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    echo "Installing dependencies..."
    ./venv/bin/pip install -r requirements.txt
fi

# Ensure directories exist
mkdir -p music data/covers

echo "Starting server on http://0.0.0.0:8000 ..."
exec ./venv/bin/python3 -m app.main
