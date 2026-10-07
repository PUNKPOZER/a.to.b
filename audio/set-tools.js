/* Set tools: transition cache with incremental recalculation, set analysis + explainable set score, optimise (respecting
 * locks) and "find alternative" (candidates scored against BOTH neighbours). Pure functions on top of DjEngine
 * (browser global `SetTools` + Node tests). Track shape = DjEngine's engine shape. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dj-engine.js"));
  else root.SetTools = factory(root.DjEngine);
})(typeof self !== "undefined" ? self : this, function (D) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  /* ---- transition cache: only pairs that were never computed (or whose inputs changed) are computed ---- */
  class TransitionCache {
    constructor(compute) { this.compute = compute; this.map = new Map(); this.version = 0; this.computations = 0; }
    key(a, b) { return a.id + "|" + b.id; }
    get(a, b) {
      const k = this.key(a, b); let v = this.map.get(k);
      if (!v || v.version !== this.version) { v = { version: this.version, value: this.compute(a, b) }; this.map.set(k, v); this.computations++; }
      return v.value;
    }
    invalidate() { this.version++; }                 // weights / track data changed
    invalidateTrack(id) { for (const k of [...this.map.keys()]) if (k.startsWith(id + "|") || k.endsWith("|" + id)) this.map.delete(k); }
  }
  // which adjacent pairs of `next` did not exist in `prev` (the only ones that need recalculating after a reorder)
  function affectedPairs(prevIds, nextIds) {
    const had = new Set(); for (let i = 0; i < prevIds.length - 1; i++) had.add(prevIds[i] + "|" + prevIds[i + 1]);
    const out = []; for (let i = 0; i < nextIds.length - 1; i++) if (!had.has(nextIds[i] + "|" + nextIds[i + 1])) out.push(i);
    return out;
  }

  const entropyNorm = (counts) => { const n = counts.reduce((s, c) => s + c, 0); if (n === 0 || counts.length < 2) return 0; const h = -counts.reduce((s, c) => s + (c / n) * Math.log(c / n), 0); return h / Math.log(counts.length); };

  /* ---- analysis of a whole set ---- */
  function analyzeSet(tracks, transitions, opts = {}) {
    const n = tracks.length, tr = transitions.filter(Boolean);
    const overall = tr.map((t) => t.overall), eff = tracks.reduce((s, t, i) => s + t.durationSec - (i ? D.overlapSeconds(tracks[i - 1], t) : 0), 0);
    const energy = tracks.map((t) => t.profile.energy), bpm = tracks.map((t) => t.bpm), camelot = tracks.map((t) => t.key.camelot);
    const genreCount = new Map(); tracks.forEach((t) => { const g = t.genre ? t.genre.primary : "?"; genreCount.set(g, (genreCount.get(g) || 0) + 1); });
    const minIdx = overall.length ? overall.indexOf(Math.min(...overall)) : -1;
    const base = { trackCount: n, durationSec: Math.round(eff), bpm: { start: bpm[0] ?? null, end: bpm[n - 1] ?? null, min: n ? Math.min(...bpm) : null, max: n ? Math.max(...bpm) : null, flow: bpm }, energyFlow: energy, camelotFlow: camelot,
      compatFlow: overall, avgTransition: overall.length ? r1(mean(overall)) : null, minTransition: overall.length ? { index: minIdx, score: r1(overall[minIdx]) } : null,
      genres: [...genreCount.entries()].sort((a, b) => b[1] - a[1]).map(([genre, count]) => ({ genre, count, pct: Math.round((count / n) * 100) })) };
    if (n < 2) return { ...base, score: null };

    const comps = {};
    comps.transitions = r1(0.7 * mean(overall) + 0.3 * Math.min(...overall));
    const pts = opts.curvePts;
    if (pts) comps.energy = r1(clamp(100 - mean(energy.map((e, i) => Math.abs(e - D.curveAt(pts, i / Math.max(1, n - 1))))) * 1.8));
    else { const d = energy.slice(1).map((e, i) => Math.abs(e - energy[i])); comps.energy = r1(clamp(100 - Math.max(0, mean(d) - 6) * 3)); }
    const tf = tr.map((t) => t.tempo).filter((x) => x != null); if (tf.length) comps.tempo = r1(mean(tf));
    const kf = tr.map((t) => t.key).filter((x) => x != null); if (kf.length) comps.harmony = r1(mean(kf));
    const adjSame = tracks.slice(1).filter((t, i) => t.genre && tracks[i].genre && t.genre.primary === tracks[i].genre.primary).length / (n - 1);
    comps.variety = r1(clamp(60 * entropyNorm([...genreCount.values()]) + 40 * (1 - 0.5 * adjSame) ));
    const sims = opts.similarities && opts.similarities.filter((x) => x != null); if (sims && sims.length) comps.coherence = r1(mean(sims));

    const W = { transitions: 0.35, energy: 0.2, tempo: 0.1, harmony: 0.15, variety: 0.08, coherence: 0.12 };
    let s = 0, w = 0; for (const k of Object.keys(comps)) { s += W[k] * comps[k]; w += W[k]; }
    const total = Math.round(s / w), covered = w / Object.values(W).reduce((a, b) => a + b, 0);

    const strengths = [], attention = [];
    if (comps.tempo != null && comps.tempo >= 85) strengths.push({ code: "smoothTempo" });
    if (comps.harmony != null && comps.harmony >= 80) strengths.push({ code: "goodHarmony" });
    if (comps.coherence != null && comps.coherence >= 75) strengths.push({ code: "coherent" });
    if (overall.length && Math.min(...overall) >= 70) strengths.push({ code: "allTransitionsSolid" });
    tr.forEach((t, i) => {
      if (t.overall < 55) attention.push({ code: "weakTransition", index: i, score: Math.round(t.overall) });
      if (t.key != null && t.key < 40) attention.push({ code: "harmonicConflict", index: i });
      if (t.tempo != null && t.tempo < 55) attention.push({ code: "tempoJump", index: i, from: bpm[i], to: bpm[i + 1] });
    });
    for (let i = 0; i + 2 < n; i++) { // 3+ tracks at almost identical energy
      let j = i; while (j + 1 < n && Math.abs(energy[j + 1] - energy[i]) < 3) j++;
      if (j - i >= 2) { attention.push({ code: "flatEnergy", from: i, to: j }); i = j; }
    }
    return { ...base, score: { total, components: comps, confidence: covered >= 0.9 ? "high" : covered >= 0.6 ? "medium" : "low", strengths, attention } };
  }

  /* ---- optimise: locked positions stay, the rest is re-ordered by hill-climbing on a cached pair matrix ---- */
  function mulberry(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
  function optimizeOrder(tracks, opts = {}) {
    const locked = opts.lockedIds || new Set(), n = tracks.length, pair = opts.pair; // pair(a,b) -> 0..100
    const pts = opts.curvePts, rnd = mulberry(opts.seed ?? 7);
    const fit = (t, i) => (pts ? clamp(100 - Math.abs(t.profile.energy - D.curveAt(pts, i / Math.max(1, n - 1))) * 1.8) : 0);
    const cache = new Map(); const P = (a, b) => { const k = a.id + "|" + b.id; if (!cache.has(k)) cache.set(k, pair(a, b)); return cache.get(k); };
    const obj = (o) => o.reduce((s, t, i) => s + (i ? P(o[i - 1], t) : 0) + (pts ? 0.5 * fit(t, i) : 0), 0);
    let best = tracks.slice(), bestV = obj(best);
    const free = tracks.map((t, i) => (locked.has(t.id) ? -1 : i)).filter((i) => i >= 0);
    if (free.length < 2) return { order: best, score: bestV, improved: false };
    for (let it = 0; it < (opts.iterations || 4000); it++) {
      const a = free[Math.floor(rnd() * free.length)], b = free[Math.floor(rnd() * free.length)]; if (a === b) continue;
      const cand = best.slice(); [cand[a], cand[b]] = [cand[b], cand[a]];
      const v = obj(cand); if (v > bestV + 1e-9) { best = cand; bestV = v; }
    }
    return { order: best, score: bestV, improved: best.some((t, i) => t.id !== tracks[i].id) };
  }

  /* ---- alternatives for position i: must work with BOTH neighbours (not merely resemble the old track) ---- */
  function findAlternatives(order, index, candidates, opts = {}) {
    const prev = order[index - 1] || null, next = order[index + 1] || null, pts = opts.curvePts, n = order.length;
    const inSet = new Set(order.map((t) => t.id));
    const rows = candidates.filter((c) => !inSet.has(c.id)).map((c) => {
      const a = prev ? D.djCompat(prev, c, opts.djWeights, opts.keyWeights) : null, b = next ? D.djCompat(c, next, opts.djWeights, opts.keyWeights) : null;
      const sa = prev && opts.sonic ? opts.sonic(prev, c) : null, sb = next && opts.sonic ? opts.sonic(c, next) : null;
      const parts = [a && a.overall, b && b.overall].filter((x) => x != null);
      if (!parts.length) return null;
      const fit = pts ? clamp(100 - Math.abs(c.profile.energy - D.curveAt(pts, index / Math.max(1, n - 1))) * 1.8) : null;
      const score = r1(mean(parts) * (fit == null ? 1 : 0.85) + (fit == null ? 0 : 0.15 * fit));
      return { track: c, score, prev: a, next: b, sonicPrev: sa, sonicNext: sb, energyFit: fit == null ? null : r1(fit), worst: Math.min(...parts) };
    }).filter(Boolean);
    return rows.sort((x, y) => y.score - x.score);
  }

  /* ---- "what to play next": every mode is a transparent re-weighting of the same measured DJ-compatibility factors ---- */
  const NEXT_MODES = ["safe", "groove", "energyUp", "energyDown", "genreSwitch", "surprise"];
  function nextCandidates(last, candidates, mode, opts = {}) {
    const rnd = mulberry(opts.seed ?? 3), rows = [];
    for (const c of candidates) {
      if (c.id === last.id) continue;
      const dj = D.djCompat(last, c, opts.djWeights, opts.keyWeights), de = c.profile.energy - last.profile.energy;
      const sameGenre = !!(last.genre && c.genre && last.genre.primary === c.genre.primary);
      const sonic = opts.sonic ? opts.sonic(last, c) : null;
      let score, fit = null;
      if (mode === "safe") score = Math.min(dj.overall, dj.key == null ? dj.overall : dj.key + 20, dj.tempo == null ? dj.overall : dj.tempo + 15);
      else if (mode === "groove") { const g = [dj.groove, dj.rhythm, dj.tempo].filter((x) => x != null); score = g.length ? 0.6 * mean(g) + 0.4 * dj.overall : dj.overall; }
      else if (mode === "energyUp" || mode === "energyDown") { const want = mode === "energyUp" ? 1 : -1; fit = clamp(100 - Math.abs(de * want - 14) * 4, 0, 100); score = 0.55 * dj.overall + 0.45 * fit; }
      else if (mode === "genreSwitch") { fit = sameGenre ? 0 : 100; score = 0.6 * dj.overall + 0.4 * fit; if (dj.overall < 50) score *= 0.6; }
      else { fit = rnd() * 100; score = dj.overall >= 55 ? 0.5 * dj.overall + 0.5 * fit : 0.3 * dj.overall; }
      rows.push({ track: c, score: r1(score), dj, sonic, energyDelta: Math.round(de), sameGenre, fit: fit == null ? null : r1(fit) });
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  return { TransitionCache, affectedPairs, analyzeSet, optimizeOrder, findAlternatives, nextCandidates, NEXT_MODES };
});
