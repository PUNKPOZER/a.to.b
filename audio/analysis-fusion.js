/* Analysis fusion: reconciles the legacy DSP estimates with Essentia.js.
 * Pure functions, no DOM — loadable in the browser (window.AnalysisFusion)
 * and in Node for tests. Reliability numbers here are NOESIS's own
 * agreement measure between independent methods, not a model confidence;
 * the raw Essentia confidence/strength is kept separately (modelConfidence).
 * The exact formulas are documented next to each function. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AnalysisFusion = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const BPM_MIN = 70, BPM_MAX = 190; // the app's working tempo range
  const RATIOS = [1.0, 2.0, 0.5, 1.5, 2 / 3, 0.75, 4 / 3];
  // Legacy estimates are quantized to the analysis hop (~23 ms): at ~150 BPM one
  // frame is ~6.7% of the tempo, so the legacy-vs-Essentia tolerance is 6%, not 4%.
  const LEGACY_TOL_PCT = 6.0;
  const r1 = (x) => Math.round(x * 10) / 10;

  // tempo normalization: which ratio best maps b onto a (half/double/2:3/3:4)
  function relation(a, b, tolPct, octaveOnly) {
    if (!(a > 0) || !(b > 0)) return { related: false, ratio: 1, distPct: 100 };
    let best = 1, bestD = Infinity;
    for (const r of (octaveOnly ? [1.0, 2.0, 0.5] : RATIOS)) { const d = Math.abs(b * r - a) / a * 100; if (d < bestD) { bestD = d; best = r; } }
    return { related: bestD <= tolPct, ratio: best, distPct: bestD };
  }
  function foldIntoRange(bpm) {
    while (bpm > 0 && bpm < BPM_MIN) bpm *= 2;
    while (bpm > BPM_MAX) bpm /= 2;
    return bpm;
  }

  /* BPM fusion of up to 3 sources.
   *  legacy: output of the existing fuseBpm() {value, reliability, sources, candidates}
   *  ess:    { bpm, confidence } from RhythmExtractor2013 (confidence 0..~5.3) or null
   * Essentia is the anchor (beat-tracking gives finer resolution than the
   * legacy hop-quantized estimates). Legacy values are normalized onto its
   * octave before comparing. Sources within 6% (after normalization) "agree".
   *  3 agree -> reliability = clamp(100 - 6*maxDist%, 70, 100)
   *  2 agree -> reliability = clamp(100 - 6*maxDist%, 55, 88)
   *  Essentia vs both legacy disagree -> 40 (Essentia value if its model
   *    confidence >= 3.0, else legacy value, reliability 35)
   * The reported value is weighted mean of agreeing normalized values
   * (Essentia 0.6, legacy autocorrelation 0.25, legacy peak-interval 0.15,
   * renormalized), then folded into 70-190 by octave only. */
  function fuseBpm3(legacy, ess) {
    // confidence 0 = Essentia found no reliable beat structure (e.g. silence): ignore it
    if (!ess || !(ess.bpm > 0) || !(ess.confidence > 0)) return { ...legacy, modelConfidence: null, essentiaBpm: null };
    const cand = legacy.candidates || {};
    const srcs = [{ name: "essentia.js", v: ess.bpm, w: 0.6, ratio: 1, dist: 0 }];
    const legacyList = [
      ["legacy-autocorrelation", cand.autocorrelation, 0.25],
      ["legacy-peak-interval", cand.peakInterval, 0.15],
    ];
    const rejected = [];
    for (const [name, v, w] of legacyList) {
      if (!(v > 0)) continue;
      const rel = relation(ess.bpm, v, LEGACY_TOL_PCT);
      if (rel.related) srcs.push({ name, v: v * rel.ratio, w, ratio: rel.ratio, dist: rel.distPct });
      else rejected.push(name);
    }
    const candidates = { ...cand, essentia: r1(ess.bpm) };
    const base = { candidates, modelConfidence: ess.confidence, essentiaBpm: r1(ess.bpm) };
    if (srcs.length === 1) {
      if (ess.confidence >= 3.0) {
        return { value: r1(foldIntoRange(ess.bpm)), reliability: 40, sources: ["essentia.js"], ...base, conflict: rejected };
      }
      return { ...legacy, reliability: 35, candidates, modelConfidence: ess.confidence, essentiaBpm: r1(ess.bpm), conflict: ["essentia.js"] };
    }
    const wsum = srcs.reduce((s, x) => s + x.w, 0);
    const value = srcs.reduce((s, x) => s + x.v * x.w, 0) / wsum;
    const maxDist = Math.max(...srcs.map((x) => x.dist));
    const raw = 100 - 6 * maxDist;
    const reliability = srcs.length === 3 ? Math.min(100, Math.max(70, raw)) : Math.min(88, Math.max(55, raw));
    return { value: r1(foldIntoRange(value)), reliability: Math.round(reliability), sources: srcs.map((x) => x.name), ...base, conflict: rejected };
  }

  /* ---- Key / Camelot ---- */
  const FLAT_TO_SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
  const CAMELOT = {
    "A_min": "8A", "C_maj": "8B", "E_min": "9A", "G_maj": "9B", "B_min": "10A", "D_maj": "10B",
    "F#_min": "11A", "A_maj": "11B", "C#_min": "12A", "E_maj": "12B", "G#_min": "1A", "B_maj": "1B",
    "D#_min": "2A", "F#_maj": "2B", "A#_min": "3A", "C#_maj": "3B", "F_min": "4A", "G#_maj": "4B",
    "C_min": "5A", "D#_maj": "5B", "G_min": "6A", "A#_maj": "6B", "D_min": "7A", "F_maj": "7B",
  };
  // Deterministic: (key, scale) -> Camelot. Never guessed by a model.
  function toCamelot(key, scale) {
    const tonic = FLAT_TO_SHARP[key] || key;
    const mode = /^maj/i.test(scale) ? "maj" : "min";
    return { tonic, mode, camelot: CAMELOT[tonic + "_" + mode] || "unknown" };
  }
  function camelotDist(a, b) { // same metric as the app's camelotDistance
    if (!a || !b || a === "unknown" || b === "unknown") return null;
    if (a === b) return 0;
    const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
    if (na === nb && la !== lb) return 0;
    const ring = Math.min(((na - nb) % 12 + 12) % 12, ((nb - na) % 12 + 12) % 12);
    return la === lb ? ring : ring + 1;
  }

  /* Key fusion: legacy (Krumhansl-Schmuckler on FFT chroma) vs Essentia
   * KeyExtractor (HPCP + tuning correction). `essKeys` = array of
   * { profile, key, scale, strength }; the stronger profile is used.
   *  identical Camelot      -> reliability = 75 + 25*strength   (strength 0..1)
   *  relative / neighbouring (Camelot distance <= 1) -> Essentia's key, 50
   *  disagreement           -> Essentia's key, 35
   * (Essentia's HPCP chroma is tuning-corrected and peak-based, so it wins a
   * tie; the disagreement is surfaced in reliability, not hidden.) */
  function fuseKey(legacyKey, essKeys) {
    const valid = (essKeys || []).filter((k) => k && k.key && k.strength > 0 && CAMELOT[(FLAT_TO_SHARP[k.key] || k.key) + "_" + (/^maj/i.test(k.scale) ? "maj" : "min")]);
    if (!valid.length) return null;
    const best = valid.slice().sort((a, b) => b.strength - a.strength)[0];
    const e = toCamelot(best.key, best.scale);
    const d = camelotDist(legacyKey.camelot, e.camelot);
    let reliability, agreement;
    if (d === 0 && legacyKey.camelot === e.camelot) { reliability = Math.round(75 + 25 * Math.max(0, Math.min(1, best.strength))); agreement = "match"; }
    else if (d !== null && d <= 1) { reliability = 50; agreement = "neighbour"; }
    else { reliability = 35; agreement = "conflict"; }
    return {
      key: { tonic: e.tonic, mode: e.mode, camelot: e.camelot, confidence: reliability },
      reliability, agreement, modelStrength: best.strength, profile: best.profile,
      sources: ["essentia.js"].concat(agreement === "match" ? ["legacy-krumhansl"] : []),
      legacyCamelot: legacyKey.camelot,
    };
  }


  /* ---- Backend (Essentia Python) fusion: priority MANUAL > BACKEND > LOCAL ----
   * BPM: the backend value (whole track, 3 estimators + beat-grid fit) is the
   * anchor. Every other source present (essentia.js, legacy autocorr/peak) is
   * octave-normalised onto it and counted as agreeing if within tolerance.
   *   reliability = 100 * agreeing / present sources   (backend counts as 1)
   * The backend's own internal estimator agreement is reported separately. */
  function fuseBpmBackend(backend, candidates) {
    const c = candidates || {};
    const others = [["essentia.js", c.essentia, 4.0], ["legacy-autocorrelation", c.autocorrelation, LEGACY_TOL_PCT], ["legacy-peak-interval", c.peakInterval, LEGACY_TOL_PCT], ["all-in-one", c.allin1, 4.0]]
      .filter(([, v]) => v > 0);
    const agree = ["essentia-backend"];
    const disagree = [];
    for (const [name, v, tol] of others) {
      const rel = relation(backend.value, v, tol, true); // octave only: 2:3 / 3:4 are not tempo equivalence
      (rel.related ? agree : disagree).push(name);
    }
    const total = 1 + others.length;
    return { value: r1(backend.value), reliability: Math.round(100 * agree.length / total), sources: agree, disagreeing: disagree,
             backendReliability: backend.reliability, modelConfidence: backend.modelConfidence ?? null };
  }

  /* Key: backend vote share (6 profiles x whole track + 40 s segments) is the
   * base reliability; agreement with the browser's Essentia.js key moves it:
   * match -> halfway to 100, mismatch -> halved. */
  function fuseKeyBackend(backendKey, localCamelot) {
    const base = backendKey.reliability;
    let reliability = base, agreement = null;
    if (localCamelot && localCamelot !== "unknown") {
      agreement = localCamelot === backendKey.value ? "match" : "mismatch";
      reliability = agreement === "match" ? Math.round((base + 100) / 2) : Math.round(base / 2);
    }
    return { reliability, agreement, base };
  }

  return { fuseBpmBackend, fuseKeyBackend, fuseBpm3, fuseKey, toCamelot, relation, foldIntoRange, camelotDist };
});
