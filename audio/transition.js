/* Transition Guide: where to leave track A and enter track B, for how many bars, and with what kind of blend.
 * Pure functions (browser global `Transition` + Node tests). Everything is derived from measured data — the bar grid
 * (All-In-One downbeats, or a constant-tempo grid built from BPM + first beat and flagged "estimated"), the section
 * labels, loudness per section, tempo, key and the DJ-compatibility factors. Nothing is guessed when the data is missing.
 *
 * Track shape: { id, bpm, bpmReliability, durationSec, key:{camelot}, genre:{primary}, profile:{energy, bassDensity},
 *   downbeats:number[]|null, gridKind:"analyzed"|"estimated"|null, segments:[{start,end,label,energyDb}]|null,
 *   introBars:number|null, outroBars:number|null }
 * compat (optional): the factors of DjEngine.djCompat(a, b) -> { overall, tempo, key, rhythm, energy, genre } */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./grid.js"));
  else root.Transition = factory(root.Grid);
})(typeof self !== "undefined" ? self : this, function (Grid) {
  const PHRASE_BARS = 16;
  const LENGTHS = [64, 32, 16, 8, 4];
  const r1 = (x) => Math.round(x * 10) / 10;

  const barSec = (T) => (T.downbeats && T.downbeats.length > 2 ? (T.downbeats[T.downbeats.length - 1] - T.downbeats[0]) / (T.downbeats.length - 1) : (T.bpm > 0 ? 240 / T.bpm : null));
  const sectionAt = (segs, t) => (segs || []).find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) || null;
  const tempoDiffPct = (a, b) => { // half/double-time aware
    let best = Infinity; for (const r of [1, 2, 0.5]) best = Math.min(best, Math.abs(b * r - a) / a * 100); return best;
  };
  const camelotDist = (a, b) => {
    if (!a || !b || a === "unknown" || b === "unknown") return null;
    if (a === b) return 0; const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
    if (na === nb && la !== lb) return 0;
    const ring = Math.min(((na - nb) % 12 + 12) % 12, ((nb - na) % 12 + 12) % 12); return la === lb ? ring : ring + 1;
  };

  // position descriptor for a time on a track's grid
  function describe(T, t) {
    const d = T.downbeats; if (!d || !d.length) return { time: t, bar: null, phrase: null, section: (sectionAt(T.segments, t) || {}).label || null };
    const i = Grid.nearest(d, t), sec = sectionAt(T.segments, t);
    return { time: Math.round(t * 1000) / 1000, bar: i + 1, phrase: { n: Math.floor(i / PHRASE_BARS) + 1, bar: (i % PHRASE_BARS) + 1 }, section: sec ? sec.label : null,
             onGrid: Math.abs(d[i] - t) < 0.06, barsBeforeEnd: Math.max(0, Math.round((T.durationSec - t) / barSec(T))) };
  }

  function chooseMixOut(A) {
    const d = A.downbeats, bar = barSec(A), segs = A.segments || [];
    const outro = [...segs].reverse().find((s) => s.label === "outro" && (s.end - s.start) / bar >= 4);
    if (outro) { const i = Grid.nearest(d, outro.start); return { idx: i, why: "outro-start" }; }
    // no labelled outro: last phrase boundary that still leaves a full 32-bar (else 16-bar) tail
    for (const need of [32, 16, 8]) {
      for (let i = d.length - 1; i >= 0; i--) {
        if (i % PHRASE_BARS === 0 && d[i] >= A.durationSec * 0.5 && (A.durationSec - d[i]) / bar >= need) return { idx: i, why: "phrase-boundary" };
      }
    }
    const i = Math.max(0, d.length - 9); return { idx: i, why: "last-bars" };
  }

  function chooseType(ctx) {
    const { A, B, L, tdiff, kd, compat, outSec, firstChorus, introB } = ctx, reasons = [];
    const keyBad = compat && compat.key != null && compat.key < 40;
    if (tdiff > 8 || (keyBad && L <= 8)) {
      if (tdiff > 8) reasons.push({ k: "tempoFar", v: r1(tdiff) });
      if (keyBad) reasons.push({ k: "keyClash" });
      return { key: "quick_cut", reasons };
    }
    if (outSec && (outSec.label === "break" || outSec.label === "bridge")) { reasons.push({ k: "outInBreak" }); return { key: "breakdown", reasons }; }
    if (firstChorus && L >= 16 && introB >= L && firstChorus.jumpDb >= 3 && (A.profile.energy >= 55)) {
      reasons.push({ k: "chorusAfterIntro", v: r1(firstChorus.jumpDb) }); return { key: "drop_swap", reasons };
    }
    if (L >= 32 && tdiff <= 3 && (kd == null || kd <= 1)) { reasons.push({ k: "longOverlapRoom", v: L }); return { key: "long_blend", reasons }; }
    if (L >= 16 && tdiff <= 3 && (A.profile.bassDensity || 0) >= 50 && (B.profile.bassDensity || 0) >= 50) {
      reasons.push({ k: "bothBassHeavy" }); return { key: "bass_swap", reasons };
    }
    if (Math.abs(B.profile.energy - A.profile.energy) >= 18 && A.genre && B.genre && A.genre.primary !== B.genre.primary) { reasons.push({ k: "bigEnergyAndGenreMove" }); return { key: "energy_reset", reasons }; }
    if (!A.outroBars && L <= 8) { reasons.push({ k: "noOutro" }); return { key: "echo_out", reasons }; }
    reasons.push({ k: "overlapBars", v: L }); return { key: "short_blend", reasons };
  }

  function difficulty(ctx) {
    const { tdiff, kd, compat, confidence, bars, energyJump } = ctx, f = []; let pts = 0;
    if (tdiff > 6) { pts += 2; f.push("tempoFar"); } else if (tdiff > 3) { pts += 1; f.push("tempoStretch"); }
    if (kd != null && kd >= 4) { pts += 2; f.push("keyFar"); } else if (kd != null && kd >= 2) { pts += 1; f.push("keyStep"); }
    if (compat && compat.rhythm != null && compat.rhythm < 50) { pts += 1; f.push("rhythmMismatch"); }
    if (bars < 8) { pts += 1; f.push("shortOverlap"); }
    if (energyJump > 20) { pts += 1; f.push("energyJump"); }
    if (confidence === "low") { pts += 1; f.push("lowConfidence"); }
    const key = pts <= 1 ? "easy" : pts <= 3 ? "medium" : pts <= 5 ? "hard" : "experimental";
    return { key, points: pts, factors: f };
  }

  function confidenceOf(A, B, tdiff) {
    const reasons = [];
    const ga = A.gridKind, gb = B.gridKind, hasSegs = !!(A.segments && A.segments.length && B.segments && B.segments.length);
    let level;
    if (ga === "analyzed" && gb === "analyzed" && hasSegs && tdiff <= 6) level = "high";
    else if (ga && gb) level = "medium"; else level = "low";
    if (ga !== "analyzed") reasons.push({ k: "gridEstimatedA" }); if (gb !== "analyzed") reasons.push({ k: "gridEstimatedB" });
    if (!hasSegs) reasons.push({ k: "noSections" });
    if (tdiff > 6) reasons.push({ k: "tempoFar" });
    const rel = Math.min(A.bpmReliability ?? 100, B.bpmReliability ?? 100);
    if (rel < 60) { reasons.push({ k: "bpmUncertain" }); if (level === "high") level = "medium"; }
    return { level, reasons };
  }

  function guide(A, B, opts = {}) {
    const compat = opts.compat || null;
    if (!A.downbeats || A.downbeats.length < 8 || !B.downbeats || B.downbeats.length < 8) {
      return { available: false, reason: !A.downbeats || !B.downbeats ? "noGrid" : "gridTooShort" };
    }
    const tdiff = tempoDiffPct(A.bpm, B.bpm), kd = camelotDist(A.key.camelot, B.key.camelot);
    const barA = barSec(A), barB = barSec(B);
    // --- mix out
    const out = chooseMixOut(A), mixOutT = A.downbeats[out.idx];
    const remainingBars = Math.floor((A.durationSec - mixOutT) / barA + 1e-6);
    // --- how much of B can sit under A: its intro (labelled) else 16 bars
    const segsB = B.segments || [], introSeg = segsB[0] && segsB[0].label === "intro" ? segsB[0] : null;
    const introB = B.introBars != null ? B.introBars : introSeg ? Math.round((introSeg.end - introSeg.start) / barB) : null;
    const capB = introB != null && introB >= 4 ? introB : 16;
    let L = LENGTHS.find((x) => x <= Math.min(remainingBars, capB)) || 0;
    if (tdiff > 3) L = Math.min(L, 16);
    if (compat && compat.key != null && compat.key < 60) L = Math.min(L, 8);
    // --- mix in at B's first downbeat unless the drop-swap variant moves it
    let mixInIdx = 0;
    const chorus = segsB.find((s, i) => s.label === "chorus" && i > 0);
    let firstChorus = null;
    if (chorus && introSeg) { const prev = segsB[segsB.indexOf(chorus) - 1]; if (prev && prev.energyDb != null && chorus.energyDb != null) firstChorus = { start: chorus.start, jumpDb: chorus.energyDb - prev.energyDb }; }
    const outSec = sectionAt(A.segments, mixOutT);
    const type = chooseType({ A, B, L: L || 0, tdiff, kd, compat, outSec, firstChorus, introB: introB ?? 0 });
    if (type.key === "drop_swap" && firstChorus) {
      const chorusIdx = Grid.nearest(B.downbeats, firstChorus.start);
      mixInIdx = Math.max(0, chorusIdx - L); // B's chorus lands exactly when the blend ends
    }
    const mixInT = B.downbeats[mixInIdx];
    const bars = type.key === "quick_cut" ? 0 : L;
    const conf = confidenceOf(A, B, tdiff);
    const energyJump = Math.abs(B.profile.energy - A.profile.energy);
    const diff = difficulty({ tdiff, kd, compat, confidence: conf.level, bars: bars || 0, energyJump });
    return {
      available: true, mixOut: describe(A, mixOutT), mixIn: describe(B, mixInT), bars, seconds: Math.round(bars * barA * 10) / 10,
      mixOutWhy: out.why, type, difficulty: diff, confidence: conf, compatibility: compat ? compat.overall : null,
      tempoDiffPct: r1(tdiff), camelotDistance: kd, estimated: A.gridKind !== "analyzed" || B.gridKind !== "analyzed", manual: false,
    };
  }

  // user-edited points win; everything derived from them is recomputed for display
  function applyManual(g, A, B, manual) {
    if (!g || !g.available || !manual) return g;
    const out = { ...g, manual: true };
    if (manual.mixOutTime != null) out.mixOut = describe(A, manual.mixOutTime);
    if (manual.mixInTime != null) out.mixIn = describe(B, manual.mixInTime);
    if (manual.bars != null) { out.bars = manual.bars; out.seconds = Math.round(manual.bars * barSec(A) * 10) / 10; }
    return out;
  }

  return { guide, applyManual, describe, barSec, sectionAt, tempoDiffPct, camelotDist, PHRASE_BARS, LENGTHS };
});
