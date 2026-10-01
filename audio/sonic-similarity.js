/* SELECTOR SONIC SIMILARITY — configuration + pure scoring functions (browser + Node tests).
 * Sonic similarity answers "how alike do these tracks SOUND?"; DJ Compatibility answers "how sensible is it to
 * play them next to each other?". They are computed independently and never copied from one another.
 * The embedding score is the calibrated Discogs-EffNet cosine (backend); it is one factor, not the whole score. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SonicSimilarity = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // ---- configuration layer (weights sum to 1) ----
  const SONIC_SIM_WEIGHTS = { embedding: 0.55, rhythm: 0.15, timbre: 0.15, energy: 0.10, harmony: 0.05 };
  // Next-track modes: how much DJ compatibility vs. how well the sonic distance fits the intent
  const NEXT_MODES = {
    safe:     { label: "Safe",     target: 100, tolerance: 60 },  // keep the sound
    balanced: { label: "Balanced", target: 70,  tolerance: 50 },  // related but not a copy
    contrast: { label: "Contrast", target: 40,  tolerance: 50 },  // deliberately change character
  };
  const NEXT_WEIGHTS = { dj: 0.65, fit: 0.35 };
  const BRIDGE_WEIGHTS = { dj: 0.50, sonic: 0.25, between: 0.25 };
  const REASON_MIN = 80; // a similarity reason is shown only when the measured sub-score reaches this

  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;

  // groups: { rhythm, texture, energy, harmony } each 0..100 (cosine of the existing computed feature groups)
  function combine(embeddingUi, groups, w = SONIC_SIM_WEIGHTS) {
    if (embeddingUi == null) return null;
    const parts = { embedding: embeddingUi, rhythm: groups.rhythm, timbre: groups.texture, energy: groups.energy, harmony: groups.harmony };
    let sum = 0, ws = 0;
    for (const k of Object.keys(w)) { if (parts[k] != null) { sum += w[k] * parts[k]; ws += w[k]; } }
    return { overall: r1(sum / (ws || 1)), parts };
  }

  // Only reasons backed by a measured number (never generated text)
  // `rel` (optional): per-key minimum, e.g. the 75th percentile of that sub-score across the candidates, so a
  // sub-score that is high for EVERY track (saturated) is not presented as a reason for this particular match.
  function reasons(parts, rel) {
    const ok = (k) => parts[k] >= REASON_MIN && (!rel || rel[k] == null || parts[k] >= rel[k]);
    const out = [];
    if (ok("embedding")) out.push({ key: "embedding", label: "Similar overall sound", value: Math.round(parts.embedding) });
    if (ok("timbre")) out.push({ key: "timbre", label: "Similar texture / timbre", value: Math.round(parts.timbre) });
    if (ok("rhythm")) out.push({ key: "rhythm", label: "Similar rhythm", value: Math.round(parts.rhythm) });
    if (ok("energy")) out.push({ key: "energy", label: "Similar energy", value: Math.round(parts.energy) });
    if (ok("harmony")) out.push({ key: "harmony", label: "Similar harmony", value: Math.round(parts.harmony) });
    return out;
  }

  function percentileThresholds(partsList, q = 0.75) {
    const out = {};
    for (const k of ["embedding", "timbre", "rhythm", "energy", "harmony"]) {
      const v = partsList.map((p) => p[k]).filter((x) => x != null).sort((a, b) => a - b);
      if (v.length >= 4) out[k] = v[Math.floor((v.length - 1) * q)];
    }
    return out;
  }

  function nextScore(mode, djOverall, sonicUi, weights = NEXT_WEIGHTS) {
    const m = NEXT_MODES[mode] || NEXT_MODES.balanced;
    if (sonicUi == null) return djOverall;
    const fit = clamp(100 - (Math.abs(sonicUi - m.target) / m.tolerance) * 100);
    return r1(weights.dj * djOverall + weights.fit * fit);
  }

  function bridgeScore(djA, djB, sonicA, sonicB, between, w = BRIDGE_WEIGHTS) {
    const dj = (djA + djB) / 2;
    if (sonicA == null || sonicB == null || between == null) return r1(dj);
    return r1(w.dj * dj + w.sonic * ((sonicA + sonicB) / 2) + w.between * between * 100);
  }

  return { SONIC_SIM_WEIGHTS, NEXT_MODES, NEXT_WEIGHTS, BRIDGE_WEIGHTS, REASON_MIN, combine, reasons, percentileThresholds, nextScore, bridgeScore };
});
