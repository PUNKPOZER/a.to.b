/* Smart Build: a DJ set from real library data for a target duration.
 * Beam search over the pool; every step is judged by DJ compatibility of the neighbouring pair (never by sonic similarity),
 * the planned energy curve, variety and — near the end — how well the real, overlap-aware duration lands on the target.
 * Locked tracks (by id, optionally at a fixed position) are honoured. Pure functions (browser global `SmartBuild` + Node tests).
 *
 * track shape: DjEngine engine shape { id, bpm, key:{camelot}, genre, profile:{energy}, durationSec, ... }
 * compat(a,b) -> 0..100 | null      overlap(a,b) -> { sec, source: "grid" | "estimate" }                                          */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dj-engine.js"));
  else root.SmartBuild = factory(root.DjEngine);
})(typeof self !== "undefined" ? self : this, function (D) {
  const r1 = (x) => Math.round(x * 10) / 10, clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const defaultOverlap = (a, b) => ({ sec: D.overlapSeconds(a, b), source: "estimate" });
  function mulberry(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

  // transition preference: minimum acceptable pair score (soft: used only while alternatives exist) and weights
  const PREFS = {
    smooth: { floor: 62, w: { compat: 0.62, energy: 0.2, variety: 0.1, floorBonus: 0.08 } },
    balanced: { floor: 48, w: { compat: 0.5, energy: 0.25, variety: 0.15, floorBonus: 0.1 } },
    creative: { floor: 35, w: { compat: 0.34, energy: 0.22, variety: 0.28, floorBonus: 0.16 } },
  };

  /* ---- duration: sum of tracks minus the overlap of every transition (measured where a grid exists, else estimated) ---- */
  function setDuration(order, overlap = defaultOverlap) {
    let sum = 0, ov = 0, measured = 0, estimated = 0;
    order.forEach((t, i) => { sum += t.durationSec; if (i) { const o = overlap(order[i - 1], t); ov += o.sec; if (o.source === "estimate") estimated++; else measured++; } });
    return { sumSec: Math.round(sum), overlapSec: Math.round(ov), effectiveSec: Math.round(sum - ov), measured, estimated, transitions: Math.max(0, order.length - 1) };
  }
  // upper bound of what a pool can deliver (tracks that all fit together, each transition at the average overlap)
  function availableSec(pool, overlap = defaultOverlap) {
    if (!pool.length) return 0;
    const sum = pool.reduce((s, t) => s + t.durationSec, 0), avg = pool.length > 1 ? mean(pool.slice(1).map((t, i) => overlap(pool[i], t).sec)) : 0;
    return Math.round(sum - avg * (pool.length - 1));
  }
  const energyTarget = (pts, pos) => D.curveAt(pts, clamp(pos, 0, 1));

  function build(opts) {
    const { pool, targetSec, toleranceSec = 120, curvePts = D.CURVES.smooth.pts, pref = "balanced", compat, startId = null, seed = 1, beam = 10, branch = 12, allowShort = false } = opts;
    const overlap = opts.overlap || defaultOverlap, P = PREFS[pref] || PREFS.balanced, rnd = mulberry(seed);
    const lockedIds = new Set((opts.locked || []).map((l) => l.id)), at = new Map((opts.locked || []).filter((l) => l.index != null).map((l) => [l.index, l.id]));
    const byId = new Map(pool.map((t) => [t.id, t]));
    const avail = availableSec(pool, overlap);
    if (!pool.length) return { ids: [], status: "insufficient", matched: 0, availableSec: 0, targetSec, effectiveSec: 0, diffSec: -targetSec };
    if (avail < targetSec - toleranceSec && !allowShort) return { ids: [], status: "insufficient", matched: pool.length, availableSec: avail, targetSec, effectiveSec: 0, diffSec: avail - targetSec };

    const pairCache = new Map(), pair = (a, b) => { const k = a.id + ">" + b.id; if (!pairCache.has(k)) { const c = compat(a, b); pairCache.set(k, c == null ? 50 : c); } return pairCache.get(k); };
    const ovCache = new Map(), ov = (a, b) => { const k = a.id + ">" + b.id; if (!ovCache.has(k)) ovCache.set(k, overlap(a, b).sec); return ovCache.get(k); };
    const dur = (seq) => seq.reduce((s, t, i) => s + t.durationSec - (i ? ov(seq[i - 1], t) : 0), 0);

    // opening track: a locked track at index 0, the requested start, else the best match for the start of the curve
    const first = at.get(0) ? [byId.get(at.get(0))] : startId && byId.get(startId) ? [byId.get(startId)] : pool.slice().sort((a, b) => Math.abs(a.profile.energy - curvePts[0]) - Math.abs(b.profile.energy - curvePts[0])).slice(0, beam);
    let beams = first.filter(Boolean).map((t) => ({ seq: [t], score: 100 - Math.abs(t.profile.energy - curvePts[0]), cmp: [] }));
    const done = [], lo = targetSec - toleranceSec, hi = targetSec + toleranceSec;
    for (let iter = 0; iter < 80 && beams.length; iter++) {
      const next = [];
      for (const bm of beams) {
        const d0 = dur(bm.seq);
        if (d0 >= lo && !(lockedIds.size && [...lockedIds].some((id) => !bm.seq.some((s) => s.id === id)))) { done.push(bm); if (d0 >= hi) continue; }
        if (d0 >= hi) continue;
        const used = new Set(bm.seq.map((t) => t.id)), last = bm.seq[bm.seq.length - 1], idx = bm.seq.length;
        let cands = at.has(idx) && !used.has(at.get(idx)) ? [byId.get(at.get(idx))] : pool.filter((t) => !used.has(t.id) && ![...at.entries()].some(([i, id]) => id === t.id && i !== idx));
        cands = cands.filter(Boolean);
        if (!cands.length) { done.push(bm); continue; }   // pool exhausted: this is as long as it gets
        const scored = cands.map((c) => {
          const cp = pair(last, c), d = d0 + c.durationSec - ov(last, c), pos = d / targetSec, ef = clamp(100 - Math.abs(c.profile.energy - energyTarget(curvePts, pos)) * 1.8);
          const gv = bm.seq.slice(-2).some((s) => s.genre && c.genre && s.genre.primary === c.genre.primary) ? (pref === "creative" ? 20 : 60) : 100;
          const lands = d >= lo && d <= hi ? 100 : d > hi ? clamp(100 - ((d - hi) / toleranceSec) * 60) : 60 + clamp((d / lo) * 40, 0, 40);
          const lockBonus = lockedIds.has(c.id) ? 25 : 0;
          const step = P.w.compat * cp + P.w.energy * ef + P.w.variety * gv + P.w.floorBonus * (cp >= P.floor ? 100 : 0) + (pref === "creative" ? 14 * rnd() : 4 * rnd()) + 0.15 * lands + lockBonus;
          return { c, step, cp, ok: cp >= P.floor };
        }).sort((a, b) => b.step - a.step);
        const pick = (scored.some((s) => s.ok) ? scored.filter((s) => s.ok) : scored).slice(0, branch);   // the floor is soft: with no acceptable neighbour, the best available is used
        for (const s of pick) next.push({ seq: [...bm.seq, s.c], score: bm.score + s.step, cmp: [...bm.cmp, s.cp] });
      }
      const seen = new Set();
      beams = next.sort((a, b) => b.score / b.seq.length - a.score / a.seq.length).filter((b) => { const k = b.seq.slice(-2).map((t) => t.id).join(">") + ":" + b.seq.length; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, beam);
    }
    const all = done.concat(beams).filter((b) => b.seq.length >= 2);
    const grade = (b) => { const d = dur(b.seq), miss = Math.max(0, Math.abs(d - targetSec) - toleranceSec); return b.score / b.seq.length - miss / 30; };
    const best = all.sort((a, b) => grade(b) - grade(a))[0];
    if (!best) return { ids: pool.slice(0, 1).map((t) => t.id), status: "insufficient", matched: pool.length, availableSec: avail, targetSec, effectiveSec: 0, diffSec: -targetSec };
    // locked tracks that the search did not reach are inserted where they cost the least
    let seq = best.seq.slice();
    for (const id of lockedIds) if (!seq.some((s) => s.id === id) && byId.get(id)) {
      const t = byId.get(id), forced = [...at.entries()].find(([, v]) => v === id);
      let bi = forced ? Math.min(forced[0], seq.length) : seq.length, bv = -1;
      if (!forced) for (let i = 1; i <= seq.length; i++) { const v = (i > 0 ? pair(seq[i - 1], t) : 100) + (i < seq.length ? pair(t, seq[i]) : 100); if (v > bv) { bv = v; bi = i; } }
      seq.splice(bi, 0, t);
    }
    seq = fitToTarget(seq, pool, { targetSec, toleranceSec, compat, overlap, locked: lockedIds, pinned: new Set([...at.entries()].map(([, id]) => id)) });
    const d = setDuration(seq, overlap), cmp = seq.slice(1).map((t, i) => pair(seq[i], t));
    const diff = d.effectiveSec - targetSec;
    return { ids: seq.map((t) => t.id), status: Math.abs(diff) <= toleranceSec ? "ok" : "off", effectiveSec: d.effectiveSec, targetSec, diffSec: diff, withinTolerance: Math.abs(diff) <= toleranceSec, duration: d,
      avgCompat: cmp.length ? r1(mean(cmp)) : null, minCompat: cmp.length ? r1(Math.min(...cmp)) : null, matched: pool.length, availableSec: avail };
  }

  /* ---- bring the real (grid-based) duration into tolerance: drop / swap / add at the end, locked tracks never removed ---- */
  function fitToTarget(seq, pool, o) {
    const { targetSec, toleranceSec, compat, overlap, locked = new Set(), pinned = new Set() } = o, out = seq.slice();
    const dur = (s) => setDuration(s, overlap).effectiveSec;
    for (let it = 0; it < 6; it++) {
      const d = dur(out), diff = d - targetSec; if (Math.abs(diff) <= toleranceSec) break;
      const used = new Set(out.map((t) => t.id)), tail = out[out.length - 1], canEdit = out.length > 2 && !locked.has(tail.id) && !pinned.has(tail.id);
      const rest = pool.filter((t) => !used.has(t.id)), cmp = (a, b) => { const c = compat(a, b); return c == null ? 50 : c; };
      if (diff > 0) { // too long: swap the last for a shorter compatible one, else drop it
        const prev = out[out.length - 2];
        const alt = rest.filter((t) => t.durationSec < tail.durationSec).map((t) => ({ t, d: dur(out.slice(0, -1).concat(t)), c: cmp(prev, t) })).filter((x) => Math.abs(x.d - targetSec) < Math.abs(diff) && x.c >= 40).sort((a, b) => Math.abs(a.d - targetSec) - Math.abs(b.d - targetSec) || b.c - a.c)[0];
        if (alt && canEdit) out[out.length - 1] = alt.t;
        else if (canEdit && Math.abs(dur(out.slice(0, -1)) - targetSec) < Math.abs(diff)) out.pop();
        else break;
      } else {        // too short: append the best compatible track that moves the duration towards the target
        const add = rest.map((t) => ({ t, d: dur(out.concat(t)), c: cmp(tail, t) })).filter((x) => Math.abs(x.d - targetSec) < Math.abs(diff) && x.c >= 40).sort((a, b) => Math.abs(a.d - targetSec) - Math.abs(b.d - targetSec) || b.c - a.c)[0];
        if (add) out.push(add.t); else break;
      }
    }
    return out;
  }

  /* ---- regenerate the unlocked part: locked positions stay, each gap is refilled with the best compatible chain ---- */
  function regenerate(order, pool, o) {
    const { lockedIndexes, compat, curvePts = D.CURVES.smooth.pts, beam = 8 } = o, locked = new Set(lockedIndexes), out = order.slice(), n = order.length;
    const used = new Set(order.filter((_, i) => locked.has(i)).map((t) => t.id));
    const free = pool.filter((t) => !used.has(t.id) && !order.some((x) => x.id === t.id && locked.has(order.indexOf(x))));
    const cmp = (a, b) => { const c = compat(a, b); return c == null ? 50 : c; };
    let i = 0;
    while (i < n) {
      if (locked.has(i)) { i++; continue; }
      let j = i; while (j < n && !locked.has(j)) j++;
      const len = j - i, prev = i > 0 ? out[i - 1] : null, next = j < n ? out[j] : null;
      // candidates: the old tracks of this gap plus the free pool (so nothing is lost when no better one exists)
      const cand = [...new Map([...order.slice(i, j), ...free].filter((t) => !used.has(t.id)).map((t) => [t.id, t])).values()];
      let beams = [{ seq: [], score: 0 }];
      for (let k = 0; k < len; k++) {
        const nb = [];
        for (const b of beams) {
          const lastT = b.seq.length ? b.seq[b.seq.length - 1] : prev, taken = new Set(b.seq.map((t) => t.id));
          for (const c of cand) { if (taken.has(c.id)) continue;
            const pos = (i + k) / Math.max(1, n - 1), ef = clamp(100 - Math.abs(c.profile.energy - energyTarget(curvePts, pos)) * 1.8);
            const s = (lastT ? cmp(lastT, c) : 70) * 0.7 + ef * 0.3 + (k === len - 1 && next ? cmp(c, next) * 0.5 : 0);
            nb.push({ seq: [...b.seq, c], score: b.score + s }); }
        }
        beams = nb.sort((a, b) => b.score - a.score).slice(0, beam);
      }
      const best = beams[0]; if (best) best.seq.forEach((t, k) => { out[i + k] = t; used.add(t.id); });
      i = j;
    }
    return out;
  }

  /* ---- bridges: one or two tracks C (D) so that A -> C -> B (A -> C -> D -> B) works on every step ---- */
  function findBridges(a, b, candidates, o) {
    const { compat, max = 8, two = false, topK = 14 } = o, cmp = (x, y) => { const c = compat(x, y); return c == null ? 50 : c; };
    const pool = candidates.filter((c) => c.id !== a.id && c.id !== b.id), rows = [];
    for (const c of pool) { const s1 = cmp(a, c), s2 = cmp(c, b); rows.push({ path: [c], steps: [s1, s2], score: r1(0.5 * Math.min(s1, s2) + 0.5 * (s1 + s2) / 2) }); }
    if (two) {
      const near = pool.map((c) => ({ c, s: cmp(a, c) })).sort((x, y) => y.s - x.s).slice(0, topK), far = pool.map((c) => ({ c, s: cmp(c, b) })).sort((x, y) => y.s - x.s).slice(0, topK);
      for (const x of near) for (const y of far) { if (x.c.id === y.c.id) continue; const s2 = cmp(x.c, y.c), steps = [x.s, s2, y.s]; rows.push({ path: [x.c, y.c], steps, score: r1(0.5 * Math.min(...steps) + 0.5 * (steps[0] + steps[1] + steps[2]) / 3) }); }
    }
    return rows.sort((p, q) => q.score - p.score).slice(0, max);
  }
  return { PREFS, setDuration, availableSec, build, fitToTarget, regenerate, findBridges };
});
