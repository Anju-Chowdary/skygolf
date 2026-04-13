#!/usr/bin/env bash
# ──────────────────────────────────────────
#  SkyGolf – local dev startup
#  Usage: bash start.sh
# ──────────────────────────────────────────
set -e

# 1. Create & activate virtual environment if not present
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

# Activate
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OS" == "Windows_NT" ]]; then
  source venv/Scripts/activate
else
  source venv/bin/activate
fi

# 2. Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# 3. Copy .env if missing
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "⚠  .env created from .env.example — update MONGO_URI and SECRET_KEY before deploying!"
  fi
fi

# 4. Start Flask
echo "Starting SkyGolf backend on http://127.0.0.1:5000"
python app.py
