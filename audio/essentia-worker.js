/* Essentia.js analysis worker (classic worker — works on static hosting).
 * Runs the WASM algorithms off the main thread so the UI never freezes.
 * API used (verified against installed essentia.js 0.1.3 typings and run in
 * Node): RhythmExtractor2013, KeyExtractor, Danceability, OnsetRate.
 * Input:  { id, samples: Float32Array (mono, 44100 Hz) }
 * Output: { id, ok, result | error }  — only compact scalars, no frame arrays. */
// The UMD WASM build (WASM embedded as base64, worker-aware). The "web" build
// assumes `document` and cannot run in a worker. It is CommonJS-flavoured: it
// ends with `exports.EssentiaWASM = Module`, so provide `exports`, and
// pre-declare Module to get notified when the runtime is ready.
var exports = {};
var wasmReady = null;
var Module = { onRuntimeInitialized: function () { wasmReady && wasmReady(); } };
const wasmInit = new Promise((resolve) => { wasmReady = resolve; });
importScripts("../vendor/essentia/essentia-wasm.umd.js", "../vendor/essentia/essentia.js-core.js");

const SR = 44100;
let essentiaPromise = null;
function getEssentia() {
  if (!essentiaPromise) essentiaPromise = wasmInit.then(() => new Essentia(Module));
  return essentiaPromise;
}

function stats(arr) {
  const n = arr.length; if (!n) return { mean: null, cv: null };
  let m = 0; for (const v of arr) m += v; m /= n;
  let s = 0; for (const v of arr) s += (v - m) * (v - m);
  return { mean: m, cv: m > 0 ? Math.sqrt(s / n) / m : null };
}

// Each algorithm is isolated: one failing never discards the others.
// NB: not named `run` — the Emscripten runtime defines a global run() that would clobber it.
function extractFeatures(essentia, samples) {
  const out = { version: essentia.version, algorithms: {}, errors: {} };
  const vec = essentia.arrayToVector(samples);
  const attempt = (name, fn) => { try { out.algorithms[name] = fn(); } catch (e) { out.errors[name] = String(e && e.message || e); } };
  try {
    attempt("RhythmExtractor2013", () => {
      const r = essentia.RhythmExtractor2013(vec, 208, "multifeature", 40);
      const ticks = essentia.vectorToArray(r.ticks);
      const intervals = essentia.vectorToArray(r.bpmIntervals);
      const est = essentia.vectorToArray(r.estimates);
      const iv = stats(Array.from(intervals));
      const res = { bpm: r.bpm, confidence: r.confidence, beatCount: ticks.length,
        beatIntervalCv: iv.cv, estimateCount: est.length,
        firstBeatSec: ticks.length ? ticks[0] : null };
      [r.ticks, r.bpmIntervals, r.estimates].forEach((v) => v.delete && v.delete());
      return res;
    });
    // bgate is Essentia's default; edma is the EDM-specific profile (Faraldo et al.).
    // Both are run and the stronger is used — they are not independent sources.
    for (const profile of ["bgate", "edma"]) {
      attempt("KeyExtractor:" + profile, () => {
        const k = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile, SR);
        return { key: k.key, scale: k.scale, strength: k.strength };
      });
    }
    attempt("Danceability", () => {
      const d = essentia.Danceability(vec);
      if (d.dfa && d.dfa.delete) d.dfa.delete();
      return { value: d.danceability };
    });
    attempt("OnsetRate", () => {
      const o = essentia.OnsetRate(vec);
      const res = { onsetRate: o.onsetRate, onsetCount: o.onsets.size ? o.onsets.size() : null };
      if (o.onsets.delete) o.onsets.delete();
      return res;
    });
  } finally { vec.delete && vec.delete(); }
  return out;
}

self.onmessage = async (ev) => {
  const { id, samples } = ev.data;
  try {
    const essentia = await getEssentia();
    self.postMessage({ id, ok: true, result: extractFeatures(essentia, samples) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
self.postMessage({ type: "boot" });
