/* Coloured 3-band waveform (Rekordbox-style): amplitude outline + per-bin
 * low/mid/high shares. Pure functions (browser + Node). The stored form is
 * one compact base64 string (4 bytes per bin) — safe for localStorage. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Waveform = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LOW_HZ = 250, HIGH_HZ = 2500;
  const BINS = 800;

  function onePole(fc, sr) { return 1 - Math.exp((-2 * Math.PI * fc) / sr); }

  // -> { bins, amp, low, mid, high }  (each Uint8Array, 0..255, bands normalised per band)
  function compute(mono, sampleRate, bins = BINS) {
    const n = mono.length;
    const aL = onePole(LOW_HZ, sampleRate), aH = onePole(HIGH_HZ, sampleRate);
    const amp = new Float32Array(bins), eL = new Float32Array(bins), eM = new Float32Array(bins), eH = new Float32Array(bins);
    const cnt = new Uint32Array(bins);
    let lp1 = 0, lp2 = 0;
    const per = n / bins;
    for (let i = 0; i < n; i++) {
      const x = mono[i];
      lp1 += aL * (x - lp1);
      lp2 += aH * (x - lp2);
      const low = lp1, mid = lp2 - lp1, high = x - lp2;
      const b = Math.min(bins - 1, (i / per) | 0);
      amp[b] += x * x;
      eL[b] += low * low; eM[b] += mid * mid; eH[b] += high * high; cnt[b]++;
    }
    const norm = (arr, perBinSqrt) => {
      const v = Array.from(arr, (s, i) => Math.sqrt(s / (cnt[i] || 1)));
      const sorted = v.slice().sort((a, b) => a - b);
      const ref = sorted[Math.floor(sorted.length * 0.95)] || 1e-9;
      return Uint8Array.from(v, (x) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(x / ref, 0.7) * 0.85))));
    };
    const rmsBins = Array.from(amp, (s, i) => Math.sqrt(s / (cnt[i] || 1)));
    const ref = rmsBins.slice().sort((a, b) => a - b)[Math.floor(bins * 0.97)] || 1e-9;
    return {
      bins,
      amp: Uint8Array.from(rmsBins, (x) => Math.min(255, Math.round(255 * Math.pow(x / ref, 0.85)))),
      low: norm(eL), mid: norm(eM), high: norm(eH),
    };
  }

  function encode(w) {
    const bytes = new Uint8Array(w.bins * 4);
    bytes.set(w.amp, 0); bytes.set(w.low, w.bins); bytes.set(w.mid, w.bins * 2); bytes.set(w.high, w.bins * 3);
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { bins: w.bins, data: (typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64")) };
  }
  function decode(e) {
    if (!e || !e.data) return null;
    const bin = typeof atob === "function" ? atob(e.data) : Buffer.from(e.data, "base64").toString("binary");
    const b = e.bins, bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length !== b * 4) return null;
    return { bins: b, amp: bytes.subarray(0, b), low: bytes.subarray(b, 2 * b), mid: bytes.subarray(2 * b, 3 * b), high: bytes.subarray(3 * b) };
  }

  // colour of one bin: low=red, mid=amber-green, high=blue (mixed by share)
  const C_LOW = [255, 59, 48], C_MID = [120, 220, 90], C_HIGH = [46, 125, 255];
  function binColor(w, i, played) {
    const e = (v) => Math.pow(v / 255, 3.2);
    const l = e(w.low[i]), m = e(w.mid[i]), h = e(w.high[i]);
    const s = l + m + h + 1e-6;
    let r = (C_LOW[0] * l + C_MID[0] * m + C_HIGH[0] * h) / s;
    let g = (C_LOW[1] * l + C_MID[1] * m + C_HIGH[1] * h) / s;
    let b = (C_LOW[2] * l + C_MID[2] * m + C_HIGH[2] * h) / s;
    const gray = (r + g + b) / 3, sat = 1.9; // push away from grey so dominant bands read as clear colour
    r = Math.max(0, Math.min(255, gray + (r - gray) * sat));
    g = Math.max(0, Math.min(255, gray + (g - gray) * sat));
    b = Math.max(0, Math.min(255, gray + (b - gray) * sat));
    const k = played ? 1 : 0.42;
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  }

  // structure colours are informational: intro blue, verse violet, chorus coral, break/bridge amber, outro green
  const SECTION_COLORS = { intro: "#6b93ff", verse: "#a487ff", chorus: "#ff6f5e", break: "#e8b64a", bridge: "#e8b64a",
    inst: "#7d8aa8", solo: "#c4a8ff", outro: "#5fd08a", start: "#555", end: "#555", high: "#ff8a6b", low: "#8b93a8" };

  function fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + String(s).padStart(2, "0"); }

  // draw into a <canvas>; progress 0..1 splits bright (played) / dim (unplayed).
  // opts.style "mono" (default for the main waveform) = greyscale bars, "spectral" = 3-band colour.
  // opts.segments [{start,end,label}] + opts.duration (s) add the structure strip (+ boundary lines);
  // opts.ruler draws timestamps along the bottom edge; opts.strip = strip height override (0 = none).
  function draw(canvas, w, progress, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!w) return;
    const hasSeg = opts.segments && opts.duration > 0;
    const strip = hasSeg ? (opts.strip != null ? opts.strip : ch >= 100 ? 16 : ch >= 50 ? 8 : 3) : 0;
    const ruler = opts.ruler ? 14 : 0;
    const top = strip ? strip + 4 : 0, bot = ch - ruler;
    const mid = (top + bot) / 2, maxH = (bot - top);
    const barW = cw / w.bins;
    const spectral = opts.style === "spectral";
    for (let i = 0; i < w.bins; i++) {
      const h = Math.max(1, (w.amp[i] / 255) * maxH);
      const played = (i + 0.5) / w.bins <= progress;
      if (spectral) ctx.fillStyle = binColor(w, i, played);
      else ctx.fillStyle = played ? "rgb(241,240,235)" : "rgba(241,240,235,0.32)";
      ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 0.6), h);
    }
    if (hasSeg) {
      const X = (t) => (t / opts.duration) * cw;
      ctx.font = "9px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle";
      for (const sg of opts.segments) {
        const x0 = X(sg.start), x1 = X(sg.end), col = SECTION_COLORS[sg.label] || "#888";
        ctx.fillStyle = col; ctx.fillRect(x0 + 0.5, 0, Math.max(1, x1 - x0 - 1), strip);
        if (strip >= 12 && x1 - x0 > 40) { ctx.fillStyle = "#080909"; ctx.fillText(sg.label.toUpperCase(), x0 + 5, strip / 2 + 0.5); }
        ctx.fillStyle = col; ctx.globalAlpha = 0.28; ctx.fillRect(x0, strip, 1, bot - strip); ctx.globalAlpha = 1;
      }
    }
    if (ruler && opts.duration > 0) {
      ctx.font = "9px ui-monospace, Menlo, monospace"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(241,240,235,0.4)";
      const stepSec = opts.duration > 600 ? 120 : opts.duration > 240 ? 60 : 30;
      for (let t = 0; t < opts.duration; t += stepSec) { const x = (t / opts.duration) * cw; ctx.fillRect(x, bot + 1, 1, 3); ctx.fillText(fmt(t), Math.min(x + 3, cw - 28), ch - 2); }
    }
    if (progress > 0 && progress < 1) { ctx.fillStyle = "#f1f0eb"; ctx.fillRect(progress * cw - 0.5, 0, 1.5, ch - ruler); }
  }

  return { compute, encode, decode, draw, binColor, BINS, SECTION_COLORS };
});
