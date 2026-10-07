// Lists every translation key referenced in the source (literal keys; the dynamic families are listed in test/i18n.test.mjs).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["index.html", ...["app", "ui"].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && !f.startsWith("i18n-") && f !== "i18n.js").map((f) => path.join(d, f)))];
const lit = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of src.matchAll(/\b(?:t|tx|tn)\(\s*"([A-Za-z0-9_.]+)"/g)) lit.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)) lit.add(m[1]);
}
export const keys = lit;
if (process.argv[1] && process.argv[1].endsWith("i18n-keys.mjs")) console.log([...lit].sort().join("\n"));
