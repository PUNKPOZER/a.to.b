/* Compact bar grid. All-In-One returns every downbeat; localStorage cannot hold hundreds of floats per track, so the
 * list is stored as {first, bar, dev}: a least-squares fit  t_i = first + i*bar  plus the residuals in centiseconds
 * (Int8, base64). Falls back to the raw (rounded) list when the track drifts too much for that. Browser + Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Grid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"); };
  const unb64 = (s) => { const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  function encode(downbeats) {
    const n = downbeats ? downbeats.length : 0;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += downbeats[i]; sxy += i * downbeats[i]; sxx += i * i; }
    const bar = (n * sxy - sx * sy) / (n * sxx - sx * sx), first = (sy - bar * sx) / n;
    const dev = new Int8Array(n); let ok = true;
    for (let i = 0; i < n; i++) { const r = Math.round((downbeats[i] - (first + i * bar)) * 100); if (Math.abs(r) > 127) ok = false; dev[i] = Math.max(-127, Math.min(127, r)); }
    if (!ok) return { n, raw: downbeats.map((x) => Math.round(x * 100) / 100) };
    return { n, first: Math.round(first * 1000) / 1000, bar: Math.round(bar * 100000) / 100000, dev: b64(new Uint8Array(dev.buffer)) };
  }
  function decode(g) {
    if (!g) return null;
    if (g.raw) return g.raw.slice();
    const dev = new Int8Array(unb64(g.dev).buffer), out = [];
    for (let i = 0; i < g.n; i++) out.push(Math.round((g.first + i * g.bar + dev[i] / 100) * 1000) / 1000);
    return out;
  }
  // A grid synthesised from a constant BPM and the first beat (no per-bar data): marked estimated by the caller.
  function synthesize(firstSec, bpm, durationSec, beatsPerBar = 4) {
    if (!(bpm > 0) || firstSec == null || !(durationSec > 0)) return null;
    const bar = (60 / bpm) * beatsPerBar, out = [];
    for (let t = firstSec; t < durationSec - bar * 0.5; t += bar) out.push(Math.round(t * 1000) / 1000);
    return out.length > 1 ? out : null;
  }
  // index of the downbeat nearest to time t
  function nearest(downbeats, t) {
    let lo = 0, hi = downbeats.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (downbeats[mid] < t) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(downbeats[lo - 1] - t) <= Math.abs(downbeats[lo] - t)) return lo - 1;
    return lo;
  }
  return { encode, decode, synthesize, nearest };
});
