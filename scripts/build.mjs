// "Build" for a no-bundler static site: assemble a deployable dist/ folder.
// GitHub Pages can serve either the repo root or dist/ — both are plain static.
import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
for (const need of ["index.html", "audio/essentia-worker.js", "vendor/essentia/essentia-wasm.umd.js", "ui/noesis.css", "engine/core.js"]) {
  if (!existsSync(join(root, need))) { console.error("missing " + need + " (run `npm run vendor`?)"); process.exit(1); }
}
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const item of ["index.html", "audio", "engine", "app", "ui", "assets", "vendor", "LICENSE", "README.md"]) cpSync(join(root, item), join(dist, item), { recursive: true });
console.log("built -> dist/");
