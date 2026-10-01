/* Optional modules (audio/*.js) may be missing if only index.html was deployed/copied, or blocked.
   Shims keep analysis working (legacy DSP) instead of crashing with "X is not defined". */
(function () {
  const missing = [];
  if (!window.Waveform) { missing.push("waveform.js"); window.Waveform = { compute: () => null, encode: () => null, decode: () => null, draw() {}, BINS: 0, SECTION_COLORS: {} }; }
  if (!window.AudioStore) { missing.push("audio-store.js"); const n = () => Promise.resolve(null); window.AudioStore = { put: n, get: n, del: n, clear: n }; }
  if (!window.BackendClient) { missing.push("backend-client.js"); window.BackendClient = { apiUrl: () => "", health: async () => ({ online: false, reason: "module missing" }), analyze: async () => ({ ok: false, reason: "module missing" }) }; }
  if (!window.AnalysisFusion) missing.push("analysis-fusion.js");
  if (!window.SonicSimilarity) { missing.push("sonic-similarity.js"); window.SonicSimilarity = { combine: () => null, reasons: () => [], percentileThresholds: () => ({}), nextScore: (m, dj) => dj, bridgeScore: (a, b) => (a + b) / 2, NEXT_MODES: { balanced: { label: "Balanced" } }, SONIC_SIM_WEIGHTS: {} }; }
  if (!window.Id3) { missing.push("id3.js"); window.Id3 = { parse: () => ({ title: null, artist: null, album: null, picture: null }) }; }
  if (!window.DjEngine) throw new Error("audio/dj-engine.js is required — deploy the audio/ folder with index.html");
  if (missing.length) console.warn("NOESIS: optional modules not loaded (" + missing.join(", ") + ") — deploy audio/, ui/, app/, engine/ and vendor/ together with index.html");
})();
