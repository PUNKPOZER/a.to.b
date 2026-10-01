#!/bin/bash
# Double-click me (macOS): installs what is missing on first run, then starts NOESIS.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/3.14/bin:$PATH"

if ! command -v node >/dev/null; then
  echo "Node.js not found — downloading a local copy to ~/.local/node ..."
  arch=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
  ver=$(curl -s https://nodejs.org/dist/index.json | python3 -c "import json,sys;print([x['version'] for x in json.load(sys.stdin) if x['lts']][0])")
  mkdir -p "$HOME/.local/node" && curl -sSL "https://nodejs.org/dist/$ver/node-$ver-darwin-$arch.tar.gz" | tar xz --strip-components=1 -C "$HOME/.local/node"
fi
if ! command -v ffmpeg >/dev/null; then echo "ffmpeg not found — backend analysis will not work (install: brew install ffmpeg). Frontend still runs."; fi

if [ ! -d node_modules ] || [ ! -f vendor/essentia/essentia-wasm.umd.js ]; then
  echo "First run: installing frontend dependencies ..."
  npm install && npm run vendor || { echo "npm install failed"; read -p "Press Enter"; exit 1; }
fi
if [ ! -x backend/.venv/bin/uvicorn ] && command -v ffmpeg >/dev/null; then
  echo "First run: setting up the analysis backend (Python 3.12 + Essentia) ..."
  command -v uv >/dev/null || pip3 install --user uv || python3 -m pip install --user uv
  UV=$(command -v uv || echo "$HOME/Library/Python/3.14/bin/uv")
  (cd backend && "$UV" venv --python 3.12 .venv && "$UV" pip install --python .venv/bin/python -r requirements.txt) || echo "Backend setup failed — continuing with frontend only."
fi
if [ ! -x structure/.venv/bin/python ] && [ "$(uname -m)" = "arm64" ] && command -v ffmpeg >/dev/null; then
  echo "First run: setting up structure analysis (All-In-One, a few minutes) ..."
  UV=$(command -v uv || echo "$HOME/Library/Python/3.14/bin/uv")
  (cd structure && "$UV" venv --python 3.12 .venv && "$UV" pip install --python .venv/bin/python -r requirements.txt) || echo "Structure setup failed - continuing without it."
fi
[ -z "$NO_OPEN" ] && (sleep 3; open http://localhost:8080/) &
npm run dev
