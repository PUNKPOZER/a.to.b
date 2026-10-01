// Copies the runtime files of the installed essentia.js package into
// vendor/essentia/ so the static site (GitHub Pages) can serve them from the
// same origin — no CDN dependency, no bundler. Run after `npm install`.
import { mkdirSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "essentia.js");
if (!existsSync(pkgDir)) { console.error("essentia.js is not installed — run `npm install` first"); process.exit(1); }
const out = join(root, "vendor", "essentia");
mkdirSync(out, { recursive: true });
for (const f of ["dist/essentia-wasm.umd.js", "dist/essentia.js-core.js", "LICENSE"]) {
  copyFileSync(join(pkgDir, f), join(out, f.split("/").pop()));
}
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
console.log(`vendored essentia.js ${version} -> vendor/essentia/`);
