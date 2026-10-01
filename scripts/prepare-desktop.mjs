// Collects everything the desktop app ships next to the web files into build/resources/:
//   tools/uv(.exe)    the uv package manager (downloads Python 3.12 + the backend's dependencies on first launch)
//   tools/ffmpeg(.exe)  decoder used by the backend (from the ffmpeg-static package)
//   backend/, structure/  backend source + requirements (copied out of the asar at first launch; Python can't run from it)
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, chmodSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "resources");
const win = process.platform === "win32";
const exe = (n) => (win ? n + ".exe" : n);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "tools"), { recursive: true });

if (win) { console.log("Windows build: the engine is not supported there, shipping the interface only"); process.exit(0); }

// ffmpeg
const require = createRequire(import.meta.url);
const ff = require("ffmpeg-static");
if (!ff || !existsSync(ff)) throw new Error("ffmpeg-static binary missing (run: node node_modules/ffmpeg-static/install.js)");
copyFileSync(ff, join(out, "tools", exe("ffmpeg")));

// uv (latest release for this platform)
const triple = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin", "win32-x64": "x86_64-pc-windows-msvc", "linux-x64": "x86_64-unknown-linux-gnu" }[`${process.platform}-${process.arch}`];
if (!triple) throw new Error("unsupported build platform");
const ext = win ? "zip" : "tar.gz";
const url = `https://github.com/astral-sh/uv/releases/latest/download/uv-${triple}.${ext}`;
const tmp = join(tmpdir(), `uv-dl-${Date.now()}`); mkdirSync(tmp, { recursive: true });
const archive = join(tmp, `uv.${ext}`);
execFileSync("curl", ["-fsSL", "--retry", "6", "--retry-delay", "4", "--retry-all-errors", "--connect-timeout", "30", "-o", archive, url], { stdio: "inherit" }); // curl: ships with macOS and Windows 10+
execFileSync("tar", ["-xf", archive, "-C", tmp]);
const found = (function find(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { const r = find(p); if (r) return r; } else if (e.name === exe("uv")) return p; } })(tmp);
if (!found) throw new Error("uv binary not found in archive");
copyFileSync(found, join(out, "tools", exe("uv"))); if (!win) chmodSync(join(out, "tools", "uv"), 0o755);

// backend + structure sources
cpSync(join(root, "backend", "app"), join(out, "backend", "app"), { recursive: true, filter: (s) => !s.includes("__pycache__") });
copyFileSync(join(root, "backend", "requirements.txt"), join(out, "backend", "requirements.txt"));
mkdirSync(join(out, "structure"), { recursive: true });
for (const f of ["run_allin1.py", "requirements.txt"]) copyFileSync(join(root, "structure", f), join(out, "structure", f));
console.log("desktop resources ready ->", out);
