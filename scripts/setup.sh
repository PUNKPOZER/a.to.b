#!/usr/bin/env bash
# One-shot dev environment setup: frontend deps, vendored Essentia.js, backend venv (Python 3.12 + Essentia).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js >= 18 is required (https://nodejs.org)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required for the backend (macOS: brew install ffmpeg)"; exit 1; }
npm install
npm run vendor
cd backend
if command -v uv >/dev/null; then
  uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
elif command -v python3.12 >/dev/null; then
  python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
else
  echo "Python 3.12 is required (Essentia has no wheels for 3.13+/3.14). Install uv: pip install uv"; exit 1
fi
cd ..
if [ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ]; then
  # Phase 3 (All-In-One structure analysis): isolated venv, Apple Silicon only (MLX). First analysis downloads ~0.5 GB of model weights.
  if command -v uv >/dev/null; then (cd structure && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt) || echo "structure setup failed (optional)"; fi
else
  echo "Structure analysis (All-In-One MLX) needs Apple Silicon; skipping. The rest works."
fi
echo "OK. Run: npm run dev   (frontend :8080 + backend :8000)"
