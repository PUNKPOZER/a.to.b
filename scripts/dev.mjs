// Starts the static frontend (:8080) and, if its venv exists, the backend (:8000).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const uvicorn = resolve("backend/.venv/bin/uvicorn");
const procs = [spawn(process.execPath, ["scripts/serve.mjs"], { stdio: "inherit" })];
if (existsSync(uvicorn)) {
  procs.push(spawn(uvicorn, ["app.main:app", "--port", "8000"], { cwd: "backend", stdio: "inherit" }));
} else console.log("backend venv not found — frontend only (run scripts/setup.sh)");
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop); process.on("SIGTERM", stop);
