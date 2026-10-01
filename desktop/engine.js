/* NOESIS analysis engine manager (desktop app).
 * First launch: copies the bundled backend sources to the user-data folder, lets the bundled `uv` fetch Python 3.12
 * and install the backend's dependencies (Essentia + TensorFlow, and on Apple Silicon the All-In-One structure
 * analyzer), pre-downloads the Discogs-EffNet model, then runs the FastAPI server on 127.0.0.1:8000.
 * Nothing here is bundled in the installer except uv, ffmpeg and the Python sources. */
const { app } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ENGINE_VERSION = 2; // dependency set. Sources are re-synced on every start, so bump this only when the requirements change
const WIN = process.platform === "win32";
const MAC_ARM = process.platform === "darwin" && process.arch === "arm64";
const exe = (n) => (WIN ? n + ".exe" : n);

const res = () => (app.isPackaged ? path.join(process.resourcesPath, "resources") : path.join(__dirname, "..", "build", "resources"));
const home = () => path.join(app.getPath("userData"), "engine");
const P = () => ({
  home: home(), backend: path.join(home(), "backend"), structure: path.join(home(), "structure"),
  venv: path.join(home(), "venv"), svenv: path.join(home(), "structure-venv"), models: path.join(home(), "models"),
  cache: path.join(home(), "cache"), state: path.join(home(), "state.json"),
  uv: path.join(res(), "tools", exe("uv")), ffmpeg: path.join(res(), "tools", exe("ffmpeg")),
  py: path.join(home(), "venv", WIN ? "Scripts" : "bin", exe("python")), spy: path.join(home(), "structure-venv", "bin", "python"),
});

// macOS arm64: full engine (Essentia + TensorFlow + All-In-One). Everything else (Windows): portable engine — Discogs-EffNet
// through ONNX Runtime, no Essentia (it has no Windows build) and no structure analyzer.
const FULL = MAC_ARM;
const supported = () => true;
const readState = () => { try { return JSON.parse(fs.readFileSync(P().state, "utf8")); } catch { return null; } };
const isReady = () => { const s = readState(); return !!(s && s.version === ENGINE_VERSION && fs.existsSync(P().py)); };

function run(cmd, args, { cwd, env, onLine }) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    const feed = (b) => String(b).split(/\r?\n/).forEach((l) => l.trim() && onLine && onLine(l.trim()));
    c.stdout.on("data", feed); c.stderr.on("data", feed);
    c.on("error", reject);
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`))));
  });
}

// emit({ step, total, label, line, state }) — drives the setup screen
async function setup(emit) {
  const p = P(), r = res();
  const steps = [
    ["Preparing files", async () => {
      fs.rmSync(p.backend, { recursive: true, force: true }); fs.rmSync(p.structure, { recursive: true, force: true });
      fs.cpSync(path.join(r, "backend"), p.backend, { recursive: true }); fs.cpSync(path.join(r, "structure"), p.structure, { recursive: true });
      fs.mkdirSync(p.models, { recursive: true }); fs.mkdirSync(p.cache, { recursive: true });
    }],
    ["Installing Python 3.12", () => run(p.uv, ["venv", "--python", "3.12", "--clear", p.venv], { env: uvEnv(), onLine: (l) => emit({ line: l }) })],
    [FULL ? "Installing analysis libraries (Essentia, TensorFlow) — a few minutes" : "Installing analysis libraries (ONNX Runtime)", () => run(p.uv, ["pip", "install", "--python", p.py, "-r", path.join(p.backend, FULL ? "requirements.txt" : "requirements-portable.txt")], { env: uvEnv(), onLine: (l) => emit({ line: l }) })],
    ["Downloading the Discogs-EffNet model", () => run(p.py, ["-c", "from app import sonic; print(sonic.ensure_model())"], { cwd: p.backend, env: { SELECTOR_MODEL_DIR: p.models }, onLine: (l) => emit({ line: l }) })],
  ];
  if (FULL) steps.push(
    ["Installing structure analysis (All-In-One) — a few minutes", async () => {
      await run(p.uv, ["venv", "--python", "3.12", "--clear", p.svenv], { env: uvEnv(), onLine: (l) => emit({ line: l }) });
      await run(p.uv, ["pip", "install", "--python", p.spy, "-r", path.join(p.structure, "requirements.txt")], { env: uvEnv(), onLine: (l) => emit({ line: l }) });
    }]);
  let n = 0; const total = steps.length;
  for (const [label, fn] of steps) {
    n++; emit({ step: n, total, label, state: "running" });
    try { await fn(); } catch (e) {
      if (label.startsWith("Installing structure")) { emit({ line: "Structure analysis could not be installed: " + e.message + " — continuing without it" }); continue; }
      emit({ state: "error", error: `${label}: ${e.message}` }); throw e;
    }
  }
  try { fs.rmSync(path.join(home(), "uv-cache"), { recursive: true, force: true }); } catch {} // downloaded wheels are no longer needed
  fs.writeFileSync(p.state, JSON.stringify({ version: ENGINE_VERSION, structure: FULL && fs.existsSync(p.spy), full: FULL, completedAt: Date.now() }));
  emit({ state: "done", step: total, total, label: "Ready" });
}
const uvEnv = () => ({ UV_PYTHON_INSTALL_DIR: path.join(home(), "python"), UV_CACHE_DIR: path.join(home(), "uv-cache"), UV_NO_PROGRESS: "1" });

// The Python sources travel with the app and may change between releases while the installed libraries stay valid:
// refresh them from the bundle on every start (a few hundred KB).
function syncSources() {
  const p = P(), r = res();
  fs.rmSync(path.join(p.backend, "app"), { recursive: true, force: true });
  fs.cpSync(path.join(r, "backend"), p.backend, { recursive: true });
  fs.cpSync(path.join(r, "structure"), p.structure, { recursive: true });
}

async function healthy() { try { return (await fetch("http://127.0.0.1:8000/api/health", { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }

let proc = null;
async function start(origin) {
  if (await healthy()) return "external";
  const p = P();
  if (!isReady()) return null;
  try { syncSources(); } catch (e) { /* keep the previous sources */ }
  const st = readState();
  const env = {
    SELECTOR_CORS_ORIGINS: origin, SELECTOR_FFMPEG: p.ffmpeg, SELECTOR_MODEL_DIR: p.models, SELECTOR_CACHE_DIR: p.cache,
    ...(st.structure ? { SELECTOR_STRUCTURE_PYTHON: p.spy, SELECTOR_STRUCTURE_SCRIPT: path.join(p.structure, "run_allin1.py") } : {}),
    PATH: path.dirname(p.ffmpeg) + path.delimiter + (process.env.PATH || ""), TF_CPP_MIN_LOG_LEVEL: "2",
  };
  proc = spawn(p.py, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], { cwd: p.backend, env: { ...process.env, ...env }, stdio: "ignore", windowsHide: true });
  proc.on("exit", () => { proc = null; });
  return "started";
}
const stop = () => { if (proc) proc.kill(); };
const reset = () => { try { fs.unlinkSync(P().state); } catch {} };

module.exports = { setup, start, stop, reset, isReady, supported, healthy, paths: P, ENGINE_VERSION };
