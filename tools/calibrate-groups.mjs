// Measures how the feature-group cosine similarities are distributed over a reference library, so the engine can
// turn a raw cosine into a calibrated 0-100 score (percentile of typical pairs) instead of the old (cos+1)/2 mapping
// that pushed every pair of non-negative vectors to 50-100.   usage: node tools/calibrate-groups.mjs <folder> [n]
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { spawnSync } from "node:child_process"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.window = globalThis; globalThis.AnalysisFusion = require("../audio/analysis-fusion.js");
vm.runInThisContext(fs.readFileSync("engine/core.js", "utf8"));
const folder = process.argv[2], N = +process.argv[3] || 40;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let files = walk(folder).filter((f) => /\.(mp3|wav|flac|m4a)$/i.test(f) && fs.statSync(f).size > 1.5e6).sort();
files = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / N)) === 0).slice(0, N);
const groups = {}; const keys = ["genre", "rhythm", "drums", "bass", "melody", "harmony", "energy", "texture"]; keys.forEach((k) => (groups[k] = []));
const energies = []; const dances = []; const SC = ["drumDensity", "bassDensity", "melodicDensity", "danceability", "energy", "brightness", "harmonicComplexity", "rhythmicComplexity", "tempoStability", "dynamicRange", "texture"]; const scal = {}; SC.forEach((k) => (scal[k] = []));
for (const f of files) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-t", "90", "-i", f, "-ac", "1", "-ar", "44100", "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 29 });
  if (r.status !== 0 || r.stdout.length < 44100 * 8) continue;
  const mono = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const res = analyzeChannelData(mono, 44100, { maxSeconds: 90 });
  keys.forEach((k) => groups[k].push(res.featureGroups[k])); energies.push(res.profile.energy); dances.push(res.profile.danceability); SC.forEach((k) => scal[k].push(res.profile[k]));
  console.error(path.basename(f).slice(0, 40));
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / (Math.sqrt(x * y) + 1e-12); };
const pct = [0, 1, 5, 10, 25, 50, 75, 90, 95, 99, 100]; const out = { tracks: energies.length, percentiles: pct, groups: {} };
for (const k of keys) {
  const s = []; const g = groups[k];
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) s.push(cos(g[i], g[j]));
  s.sort((a, b) => a - b);
  out.groups[k] = pct.map((p) => +s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))].toFixed(5));
}
out.scalars = {};
for (const k of SC) {
  const d = []; const v = scal[k];
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) d.push(Math.abs(v[i] - v[j]));
  d.sort((a, b) => a - b);
  out.scalars[k] = pct.map((p) => +d[Math.min(d.length - 1, Math.floor((p / 100) * (d.length - 1)))].toFixed(3));
}
out.sample = energies.length;
const js = `/* Calibration of the feature similarity scores, measured on a reference library of ${energies.length} club tracks (${energies.length * (energies.length - 1) / 2} pairs)
 * by tools/calibrate-groups.mjs. A raw cosine / difference is turned into "closer than X% of typical pairs" instead of being shown as-is.
 * cos: quantiles (ascending) of the cosine between random pairs for vector groups;  delta: quantiles of |difference| for scalar features. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.DjCalibration = factory(); })(typeof self !== "undefined" ? self : this, function () {
  return ${JSON.stringify({ percentiles: pct, tracks: energies.length, cos: out.groups, delta: out.scalars })};
});
`;
fs.writeFileSync("audio/calibration.js", js);
console.log("calibration written for", energies.length, "tracks");
