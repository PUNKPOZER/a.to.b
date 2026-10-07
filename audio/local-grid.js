/* Local bar grid + rough sections, measured from the audio itself in the browser (no backend).
 * Kick-band onsets are matched against the BPM (phase search, then beat tracking that follows slow drift); the bar line is the
 * beat phase with the most low-frequency energy. Sections come from loudness per bar. Everything here is an ESTIMATE: it is
 * stored as gridKind "local", labelled that way in the UI, never exported as a beat grid, and replaced by All-In-One data
 * when the backend has analysed the track. Pure functions (browser global `LocalGrid` + Node tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LocalGrid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const HOP = 128, TARGET_SR = 11025;

  function features(mono, sr) {
    const f = Math.max(1, Math.round(sr / TARGET_SR)), rate = sr / f, nFr = Math.floor(mono.length / f / HOP);
    const a = 1 - Math.exp((-2 * Math.PI * 160) / rate), low = new Float32Array(nFr), full = new Float32Array(nFr);
    let l1 = 0, l2 = 0;
    for (let j = 0; j < nFr; j++) {
      let sl = 0, sf = 0;
      for (let h = 0; h < HOP; h++) {
        let x = 0; const base = (j * HOP + h) * f; for (let k = 0; k < f; k++) x += mono[base + k]; x /= f;
        l1 += a * (x - l1); l2 += a * (l1 - l2); sl += l2 * l2; sf += x * x;
      }
      low[j] = Math.sqrt(sl / HOP); full[j] = Math.sqrt(sf / HOP);
    }
    const env = new Float32Array(nFr);
    for (let j = 2; j < nFr; j++) env[j] = Math.max(0, low[j] - low[j - 1]) + 0.5 * Math.max(0, low[j - 1] - low[j - 2]) * 0;
    return { env, low, full, fs: rate / HOP, nFr };
  }
  const at = (arr, x) => { const i = Math.floor(x); if (i < 0 || i >= arr.length - 1) return 0; return arr[i] + (arr[i + 1] - arr[i]) * (x - i); };

  function analyze(mono, sampleRate, bpm, opts = {}) {
    if (!(bpm > 40) || mono.length < sampleRate * 20) return null;
    const { env, low, full, fs, nFr } = features(mono, sampleRate), P = (60 / bpm) * fs;
    // 1) global beat phase
    let best = 0, bestS = -1;
    for (let ph = 0; ph < P; ph += 0.25) { let s = 0; for (let x = ph; x < nFr - 2; x += P) s += at(env, x); if (s > bestS) { bestS = s; best = ph; } }
    // 2) follow the beats (small phase corrections, fixed period)
    const beats = []; let pos = best; const win = P * 0.12;
    while (pos < nFr - 2) {
      let pk = pos, pv = -1; for (let x = pos - win; x <= pos + win; x += 0.5) { const v = at(env, x); if (v > pv) { pv = v; pk = x; } }
      pos = pos + 0.25 * (pk - pos); beats.push(pos); pos += P;
    }
    if (beats.length < 16) return null;
    // 3) which of the four beats is the bar line: the one carrying the most low-frequency energy
    const sc = [0, 0, 0, 0]; beats.forEach((b, k) => { sc[k % 4] += at(low, b + 1); });
    const order = [0, 1, 2, 3].sort((x, y) => sc[y] - sc[x]), ph = order[0], rest = (sc[order[1]] + sc[order[2]] + sc[order[3]]) / 3;
    const ratio = rest > 0 ? sc[ph] / rest : 1;
    const downbeats = beats.filter((_, k) => k % 4 === ph).map((b) => Math.round((b / fs) * 1000) / 1000);
    // 4) loudness per bar -> sections
    const dur = mono.length / sampleRate, bars = [];
    for (let i = 0; i < downbeats.length; i++) {
      const a0 = Math.floor(downbeats[i] * fs), a1 = Math.min(nFr, Math.floor((downbeats[i + 1] ?? dur) * fs)); let s = 0, n = 0; for (let j = a0; j < a1; j++) { s += full[j] * full[j]; n++; }
      bars.push(n ? 20 * Math.log10(Math.sqrt(s / n) + 1e-6) : -90);
    }
    const segs = sections(bars, downbeats, dur);
    // confidence: how clearly the kick lines up with the grid and how clear the bar line is
    const conf = bestS / Math.max(1e-9, (nFr / P) * (env.reduce((s, v) => s + v, 0) / nFr)) ;
    return { firstBeat: Math.round((beats[0] / fs) * 1000) / 1000, downbeats, barPhase: ph, barLineRatio: Math.round(ratio * 100) / 100, gridStrength: Math.round(conf * 100) / 100, segments: segs, bpm };
  }

  function sections(bars, downbeats, dur) {
    const n = bars.length; if (n < 16) return [];
    const mean = (a, i, j) => { let s = 0, c = 0; for (let k = Math.max(0, i); k < Math.min(n, j); k++) { s += a[k]; c++; } return c ? s / c : 0; };
    const nov = bars.map((_, i) => Math.abs(mean(bars, i, i + 4) - mean(bars, i - 4, i)));
    const cuts = [0];
    for (let i = 4; i < n - 4; i++) if (nov[i] >= 2.5 && nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1] && i - cuts[cuts.length - 1] >= 8) cuts.push(i);
    cuts.push(n);
    const sorted = bars.slice().sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.8)];   // loud reference
    const raw = [];
    for (let c = 0; c < cuts.length - 1; c++) raw.push({ i0: cuts[c], i1: cuts[c + 1], db: mean(bars, cuts[c], cuts[c + 1]) });
    return raw.map((s, k) => {
      const first = k === 0, last = k === raw.length - 1, quiet = s.db < ref - 3.5;
      const label = first && quiet ? "intro" : last && quiet ? "outro" : quiet ? "break" : s.db >= ref - 1.5 ? "high" : "low";
      return { start: first ? 0 : downbeats[s.i0], end: last ? dur : downbeats[s.i1] ?? dur, label, energyDb: Math.round(s.db * 10) / 10 };
    });
  }
  return { analyze, features, sections };
});
