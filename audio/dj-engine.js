/* NOESIS DJ engine: Similarity v2, DJ Compatibility v2 and the Set Builder search.
 * Pure functions (browser global `DjEngine` + Node tests). Every number here is derived from measured track
 * features; explanations are generated from those numbers by rules (no LLM, nothing invented).
 *
 * Track shape (see toEngineShape in app/state.js):
 *   { id, bpm, key:{camelot}, genre:{primary}, profile:{energy,danceability,...}, featureGroups:{genre,rhythm,drums,bass,
 *     melody,harmony,energy,texture}, energyCurve:[0..1]|null, introBars|null, outroBars|null, durationSec,
 *     beatCv|null, mfcc:[..]|null, backendDance|null }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DjEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  /* ---------------- configuration layer ---------------- */
  const SIM_WEIGHTS = { rhythm: 0.25, timbre: 0.20, harmony: 0.15, energy: 0.15, structure: 0.10, tempo: 0.10, genre: 0.05 };
  const DJ_WEIGHTS = { tempo: 0.22, key: 0.20, rhythm: 0.12, groove: 0.08, energy: 0.14, structure: 0.12, genre: 0.12 };
  const KEY_WEIGHTS = { same: 1.0, adjacent: 0.85, relative: 0.92 };
  const BUILD_WEIGHTS = { dj: 0.40, energyFit: 0.25, sonic: 0.15, variety: 0.10, surprise: 0.10 };
  const CURVES = {
    smooth:   { label: "Smooth",                 pts: [55, 58, 62, 66, 68, 66, 62] },
    buildup:  { label: "Build up",               pts: [30, 40, 50, 60, 70, 80, 90] },
    peak:     { label: "Peak time",              pts: [70, 78, 85, 90, 90, 85, 80] },
    wave:     { label: "Wave",                   pts: [45, 70, 50, 78, 55, 85, 60] },
    journey:  { label: "Warm up → Peak → Outro", pts: [30, 45, 65, 85, 80, 60, 40] },
    experimental: { label: "Experimental",       pts: [60, 35, 80, 45, 90, 30, 70] },
  };
  const OVERLAP_BARS = 16;

  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  function cosine100(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return null;
    const d = Math.hypot(...a) * Math.hypot(...b);
    if (d < 1e-9) return null;
    return r1(clamp(((dot(a, b) / d) + 1) / 2 * 100));
  }

  /* ---------------- tempo ---------------- */
  const RATIOS = [1.0, 2.0, 0.5];  // tempo equivalence: same, double-time, half-time
  function bpmRelation(a, b) {
    if (!(a > 0) || !(b > 0)) return { ratio: 1, distPct: 100, octave: false };
    let best = 1, bd = Infinity;
    for (const r of RATIOS) { const d = Math.abs(b * r - a) / a * 100; if (d < bd) { bd = d; best = r; } }
    return { ratio: best, distPct: bd, octave: best !== 1 };
  }
  // DJ pitch range: up to ~3% is inaudible, up to ~6% is normal pitch-fader work, beyond is a hard sell
  function tempoScore(a, b) {
    const { distPct, octave } = bpmRelation(a, b);
    let s = distPct <= 3 ? 100 - distPct * 3 : distPct <= 6 ? 91 - (distPct - 3) * 10 : Math.max(0, 61 - (distPct - 6) * 6);
    if (octave) s = Math.max(0, s - 10);
    return r1(s);
  }

  /* ---------------- key ---------------- */
  function camelotDistance(a, b) {
    if (!a || !b || a === "unknown" || b === "unknown") return null;
    if (a === b) return 0;
    const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
    if (na === nb && la !== lb) return 0;
    const ring = Math.min(((na - nb) % 12 + 12) % 12, ((nb - na) % 12 + 12) % 12);
    return la === lb ? ring : ring + 1;
  }
  function keyScore(a, b, w = KEY_WEIGHTS) {
    const d = camelotDistance(a, b);
    if (d === null) return 50;
    if (a === b) return 100 * (w.same ?? 1);
    if (d === 0) return 100 * (w.relative ?? 0.92);
    if (d === 1) return 100 * (w.adjacent ?? 0.85);
    return Math.max(0, 100 - d * 18);
  }

  /* ---------------- helpers over measured features ---------------- */
  function resample(curve, n = 32) {
    if (!curve || curve.length < 4) return null;
    const out = [];
    for (let i = 0; i < n; i++) out.push(curve[Math.min(curve.length - 1, Math.floor((i / n) * curve.length))]);
    return out;
  }
  function curveSimilarity(a, b) { // structure of the loudness arc over the analysed window
    const x = resample(a), y = resample(b);
    if (!x || !y) return null;
    const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
    const cx = x.map((v) => v - mx), cy = y.map((v) => v - my);
    const d = Math.hypot(...cx) * Math.hypot(...cy);
    const shape = d < 1e-9 ? 0.5 : (dot(cx, cy) / d + 1) / 2;       // arc shape agreement 0..1
    const level = 1 - Math.min(1, Math.abs(mx - my) * 2);            // average-level agreement 0..1
    return r1(100 * (0.6 * shape + 0.4 * level));
  }
  function weighted(parts, weights) {
    let s = 0, w = 0;
    for (const k of Object.keys(weights)) if (parts[k] != null) { s += weights[k] * parts[k]; w += weights[k]; }
    return w ? r1(s / w) : null;
  }

  /* ---------------- Similarity v2 (feature-based; embedding handled by SonicSimilarity) ---------------- */
  function similarity(a, b, weights = SIM_WEIGHTS, keyW = KEY_WEIGHTS) {
    const g = (k) => cosine100(a.featureGroups[k], b.featureGroups[k]);
    const danceClose = a.profile.danceability != null && b.profile.danceability != null ? 100 - Math.abs(a.profile.danceability - b.profile.danceability) : null;
    const rhythmCos = g("rhythm"), drums = g("drums");
    const rhythm = [rhythmCos, drums, danceClose].filter((x) => x != null);
    const mfccSim = a.mfcc && b.mfcc ? cosine100(a.mfcc, b.mfcc) : null;
    const texture = g("texture"), bass = g("bass");
    const chroma = g("harmony"), melody = g("melody");
    const camel = keyScore(a.key.camelot, b.key.camelot, keyW);
    const eCos = g("energy"), eClose = clamp(100 - Math.abs(a.profile.energy - b.profile.energy) * 1.4);
    const parts = {
      tempo: tempoScore(a.bpm, b.bpm),
      genre: g("genre"),
      rhythm: rhythm.length ? r1(rhythm.reduce((s, v) => s + v, 0) / rhythm.length) : null,
      timbre: (() => { const v = [texture, bass, mfccSim].filter((x) => x != null); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null; })(),
      harmony: chroma != null ? r1(0.55 * chroma + 0.15 * (melody ?? chroma) + 0.30 * camel) : r1(camel),
      energy: eCos != null ? r1((eCos + eClose) / 2) : r1(eClose),
      structure: curveSimilarity(a.energyCurve, b.energyCurve),
    };
    return { overall: weighted(parts, weights), ...parts };
  }

  /* ---------------- DJ Compatibility v2 ---------------- */
  function overlapBars(a, b) { return a.outroBars != null && b.introBars != null ? Math.min(a.outroBars, b.introBars) : null; }
  function overlapSeconds(a, b) {
    const bars = overlapBars(a, b);
    const beats = (bars != null ? Math.min(bars, OVERLAP_BARS) : OVERLAP_BARS) * 4;
    const bpm = (a.bpm + b.bpm) / 2 || 125;
    return clamp((beats * 60) / bpm, 12, 40);
  }
  function structureScore(a, b) {
    const o = overlapBars(a, b);
    if (o == null) return null;
    return o >= 16 ? 100 : o >= 8 ? 85 : o >= 4 ? 65 : 40;
  }
  function grooveScore(a, b) {
    const parts = [];
    if (a.backendDance != null && b.backendDance != null) parts.push(100 - Math.min(100, Math.abs(a.backendDance - b.backendDance) / 3 * 100));
    if (a.beatCv != null && b.beatCv != null) parts.push(100 - Math.min(100, Math.abs(a.beatCv - b.beatCv) * 600));
    return parts.length ? r1(parts.reduce((s, v) => s + v, 0) / parts.length) : null;
  }
  function energyProgressionScore(a, b, targetDelta) {
    const delta = b.profile.energy - a.profile.energy;
    if (targetDelta != null) return r1(clamp(100 - Math.abs(delta - targetDelta) * 1.6));
    const d = Math.abs(delta);
    return r1(clamp(d <= 8 ? 100 - d : 92 - (d - 8) * 1.6));
  }

  // ctx: { targetDelta } optional — the energy move the set's curve asks for at this point
  function djCompat(a, b, weights = DJ_WEIGHTS, keyW = KEY_WEIGHTS, ctx = {}) {
    const parts = {
      tempo: tempoScore(a.bpm, b.bpm),
      key: r1(keyScore(a.key.camelot, b.key.camelot, keyW)),
      rhythm: cosine100(a.featureGroups.rhythm, b.featureGroups.rhythm),
      groove: grooveScore(a, b),
      energy: energyProgressionScore(a, b, ctx.targetDelta),
      structure: structureScore(a, b),
      genre: cosine100(a.featureGroups.genre, b.featureGroups.genre),
    };
    const overall = weighted(parts, weights);
    return { overall, ...parts, transition: parts.energy, notes: explain(a, b, parts) };
  }

  // Rule-based explanation: each sentence quotes the measured values it is based on.
  function explain(a, b, p) {
    const notes = [];
    const rel = bpmRelation(a.bpm, b.bpm);
    notes.push({ key: "tempo", level: p.tempo >= 85 ? "good" : p.tempo >= 60 ? "ok" : "warn",
      text: `${a.bpm.toFixed(1)} → ${b.bpm.toFixed(1)} BPM (${rel.octave ? "half/double-time, " : ""}Δ${rel.distPct.toFixed(1)}%${rel.distPct <= 6 ? ", within pitch-fader range" : ", beyond a normal pitch move"})` });
    const d = camelotDistance(a.key.camelot, b.key.camelot);
    if (d != null) notes.push({ key: "key", level: p.key >= 85 ? "good" : p.key >= 60 ? "ok" : "warn",
      text: `${a.key.camelot} → ${b.key.camelot} (${a.key.camelot === b.key.camelot ? "same key" : d === 0 ? "relative major/minor" : d === 1 ? "adjacent on the wheel" : d + " steps apart"})` });
    const delta = Math.round(b.profile.energy - a.profile.energy);
    notes.push({ key: "energy", level: p.energy >= 85 ? "good" : p.energy >= 60 ? "ok" : "warn", text: `Energy ${a.profile.energy.toFixed(0)} → ${b.profile.energy.toFixed(0)} (${delta >= 0 ? "+" : ""}${delta})` });
    if (p.structure != null) { const o = overlapBars(a, b); notes.push({ key: "structure", level: p.structure >= 85 ? "good" : p.structure >= 60 ? "ok" : "warn", text: `Outro of A ${a.outroBars} bars, intro of B ${b.introBars} bars → ~${o} bars of overlap room` }); }
    else notes.push({ key: "structure", level: "none", text: "No intro/outro data for one of the tracks (structure analysis not available or not labelled)" });
    if (p.rhythm != null) notes.push({ key: "rhythm", level: p.rhythm >= 85 ? "good" : p.rhythm >= 60 ? "ok" : "warn", text: `Rhythm profile match ${Math.round(p.rhythm)}%` });
    if (p.groove != null) notes.push({ key: "groove", level: p.groove >= 85 ? "good" : p.groove >= 60 ? "ok" : "warn", text: `Groove match ${Math.round(p.groove)}% (danceability / beat regularity)` });
    return notes;
  }

  /* ---------------- Set Builder ---------------- */
  function curveAt(pts, pos) { // pos 0..1 along the set -> target energy 0..100 (linear interpolation)
    const x = clamp(pos, 0, 1) * (pts.length - 1), i = Math.floor(x), f = x - i;
    return pts[i] + ((pts[Math.min(i + 1, pts.length - 1)] - pts[i]) * f);
  }
  function mulberry(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
  const NEXT_FIT = { safe: [100, 60], balanced: [70, 50], contrast: [40, 50] };

  /* opts: { tracks, targetMinutes, curve:[..], startId, seed, weights, djWeights, sonic:(a,b)=>ui|null, mode, beam, branch } */
  function buildSet(opts) {
    const W = { ...BUILD_WEIGHTS, ...(opts.weights || {}) };
    const target = opts.targetMinutes * 60, pts = opts.curve || CURVES.smooth.pts;
    const rnd = mulberry(opts.seed ?? 1), beam = opts.beam || 8, branch = opts.branch || 10;
    const sonicFn = opts.sonic || (() => null), mode = NEXT_FIT[opts.mode] ? opts.mode : "balanced";
    const pool = opts.tracks.filter((t) => t.durationSec > 30);
    if (!pool.length) return { ids: [], effectiveSec: 0, steps: [] };
    const dur = (seq) => seq.reduce((s, t, i) => s + t.durationSec - (i ? overlapSeconds(seq[i - 1], t) : 0), 0);

    const startPool = opts.startId ? pool.filter((t) => t.id === opts.startId) : pool;
    const e0 = pts[0];
    let beams = startPool
      .map((t) => ({ seq: [t], score: 100 - Math.abs(t.profile.energy - e0) + (t.introBars != null ? 4 : 0), steps: [] }))
      .sort((a, b) => b.score - a.score).slice(0, beam);

    const done = [];
    for (let iter = 0; iter < 60 && beams.length; iter++) {
      const next = [];
      for (const bm of beams) {
        const cur = dur(bm.seq);
        if (cur >= target * 0.97) { done.push(bm); continue; }
        const used = new Set(bm.seq.map((t) => t.id)), last = bm.seq[bm.seq.length - 1];
        const pos = cur / target, posNext = Math.min(1, (cur + 300) / target);
        const tgtE = curveAt(pts, posNext), tgtDelta = tgtE - last.profile.energy;
        const prevGenre = bm.seq.slice(-2).map((t) => t.genre && t.genre.primary);
        const cands = [];
        for (const t of pool) {
          if (used.has(t.id)) continue;
          const dj = djCompat(last, t, opts.djWeights || DJ_WEIGHTS, KEY_WEIGHTS, { targetDelta: tgtDelta });
          const energyFit = clamp(100 - Math.abs(t.profile.energy - tgtE) * 1.8);
          const su = sonicFn(last, t);
          const [tg, tol] = NEXT_FIT[mode];
          const sonic = su == null ? 60 : clamp(100 - (Math.abs(su - tg) / tol) * 100);
          let variety = 100;
          if (prevGenre.includes(t.genre && t.genre.primary)) variety -= 30;
          if (t.key.camelot === last.key.camelot && t.bpm === last.bpm) variety -= 20;
          const surprise = rnd() * 100;
          const step = W.dj * dj.overall + W.energyFit * energyFit + W.sonic * sonic + W.variety * variety + W.surprise * surprise;
          cands.push({ t, step, dj: dj.overall, energyFit, su });
        }
        cands.sort((x, y) => y.step - x.step);
        for (const c of cands.slice(0, branch)) {
          next.push({ seq: [...bm.seq, c.t], score: bm.score + c.step, steps: [...bm.steps, { id: c.t.id, dj: c.dj, energyFit: r1(c.energyFit), sonic: c.su }] });
        }
        if (!cands.length) done.push(bm);
      }
      // keep the best by mean step score (length-fair), de-duplicate identical tails
      const seen = new Set();
      beams = next.sort((a, b) => b.score / b.seq.length - a.score / a.seq.length)
        .filter((b) => { const k = b.seq.slice(-2).map((t) => t.id).join(">"); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, beam);
      if (!beams.length) break;
    }
    const all = done.concat(beams);
    const closeEnough = all.filter((b) => dur(b.seq) >= target * 0.8);
    const ranked = (closeEnough.length ? closeEnough : all).sort((a, b) => b.score / b.seq.length - a.score / a.seq.length);
    const best = ranked[0];
    const eff = dur(best.seq);
    const curveErr = best.seq.reduce((s, t, i) => s + Math.abs(t.profile.energy - curveAt(pts, i / Math.max(1, best.seq.length - 1))), 0) / best.seq.length;
    return { ids: best.seq.map((t) => t.id), effectiveSec: Math.round(eff), steps: best.steps, curveError: r1(curveErr),
             avgDj: r1(best.steps.reduce((s, x) => s + x.dj, 0) / Math.max(1, best.steps.length)) };
  }

  return { SIM_WEIGHTS, DJ_WEIGHTS, KEY_WEIGHTS, BUILD_WEIGHTS, CURVES, bpmRelation, tempoScore, camelotDistance, keyScore,
           similarity, djCompat, explain, overlapSeconds, overlapBars, curveAt, buildSet, cosine100, curveSimilarity };
});
