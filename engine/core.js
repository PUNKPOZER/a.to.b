/* =================== core DSP + similarity engine (untouched, verified) =================== */

/* =================== core DSP (ported from the Python backend) =================== */
// ---- FFT (iterative radix-2 Cooley-Tukey) ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * curWr - im[i + j + len / 2] * curWi;
        const vi = re[i + j + len / 2] * curWi + im[i + j + len / 2] * curWr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = curWr * wr - curWi * wi, nwi = curWr * wi + curWi * wr;
        curWr = nwr; curWi = nwi;
      }
    }
  }
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// magnitude spectrum of a windowed real frame, zero-padded to pow2
function magnitudeSpectrum(frame, windowFn) {
  const n = nextPow2(frame.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * windowFn[i];
  fft(re, im);
  const half = n / 2;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag; // bin i -> freq = i * sampleRate / n
}


// ---- Chroma mapping: FFT bin -> pitch class (12) ----
function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
function binsToChroma(mag, sampleRate, fftSize) {
  const chroma = new Float64Array(12);
  const minFreq = 50, maxFreq = 5000;
  for (let i = 1; i < mag.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < minFreq || freq > maxFreq) continue;
    const midi = freqToMidi(freq);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += mag[i];
  }
  return chroma;
}

// ---- Krumhansl-Kessler key profiles ----
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const CAMELOT = {
  "A_min":"8A","C_maj":"8B","E_min":"9A","G_maj":"9B","B_min":"10A","D_maj":"10B",
  "F#_min":"11A","A_maj":"11B","C#_min":"12A","E_maj":"12B","G#_min":"1A","B_maj":"1B",
  "D#_min":"2A","F#_maj":"2B","A#_min":"3A","C#_maj":"3B","F_min":"4A","G#_maj":"4B",
  "C_min":"5A","D#_maj":"5B","G_min":"6A","A#_maj":"6B","D_min":"7A","F_maj":"7B",
};
// Camelot is always derived deterministically from (tonic, mode) via the
// table above — never guessed by a model. This is the reverse lookup, used
// when a DJ corrects a track's Camelot code directly (they think in Camelot,
// not in "F minor"): it resolves back to tonic/mode so key/scale stay
// consistent with what's displayed.
const REVERSE_CAMELOT = Object.fromEntries(Object.entries(CAMELOT).map(([k, v]) => [v, k]));
function norm(v) { const n = Math.hypot(...v); return n > 1e-9 ? v.map(x => x / n) : v; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function rotate(arr, k) { const n = arr.length; return arr.map((_, i) => arr[(i - k + n) % n]); }

function estimateKey(chromaMean) {
  const cn = norm(Array.from(chromaMean));
  let best = -1e9, bestTonic = 0, bestMode = "maj";
  const scores = [];
  for (let shift = 0; shift < 12; shift++) {
    const maj = norm(rotate(MAJOR_PROFILE, shift));
    const min = norm(rotate(MINOR_PROFILE, shift));
    const majScore = dot(cn, maj), minScore = dot(cn, min);
    scores.push(majScore, minScore);
    if (majScore > best) { best = majScore; bestTonic = shift; bestMode = "maj"; }
    if (minScore > best) { best = minScore; bestTonic = shift; bestMode = "min"; }
  }
  const mx = Math.max(...scores);
  const exp = scores.map(s => Math.exp((s - mx) * 6.0));
  const sum = exp.reduce((a, b) => a + b, 0);
  const confidence = Math.min(100, (Math.max(...exp) / sum) * 100 * 4);
  const tonic = NOTE_NAMES[bestTonic];
  const camelot = CAMELOT[`${tonic}_${bestMode}`] || "unknown";
  return { tonic, mode: bestMode, camelot, confidence: Math.round(confidence * 10) / 10 };
}

function camelotDistance(a, b) {
  if (!a || !b || a === "unknown" || b === "unknown") return null;
  if (a === b) return 0;
  const numA = parseInt(a), numB = parseInt(b);
  const letA = a.slice(-1), letB = b.slice(-1);
  if (numA === numB && letA !== letB) return 0;
  const ring = Math.min(((numA - numB) % 12 + 12) % 12, ((numB - numA) % 12 + 12) % 12);
  return letA === letB ? ring : ring + 1;
}

// ---- BPM via autocorrelation of an onset/energy envelope ----
function estimateBpm(onsetEnv, hopSeconds, minBpm = 70, maxBpm = 190) {
  const n = onsetEnv.length;
  const mean = onsetEnv.reduce((a, b) => a + b, 0) / n;
  const centered = onsetEnv.map(v => v - mean);
  const minLag = Math.floor((60 / maxBpm) / hopSeconds);
  const maxLag = Math.ceil((60 / minBpm) / hopSeconds);
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += centered[i] * centered[i + lag];
    s /= (n - lag);
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  const bpm = 60 / (bestLag * hopSeconds);
  return Math.round(bpm * 10) / 10;
}

// ---- BPM via peak-picking + median inter-onset interval ----
// A second, algorithmically independent estimate: instead of searching for
// the lag with the strongest self-correlation over the whole envelope, this
// finds actual onset peaks and takes the median spacing between them. The
// two methods fail in different ways (autocorrelation can lock onto a
// sub/super-harmonic of the true tempo; peak-picking is thrown off by
// syncopation or a sparse intro) — agreement between them is a genuine
// reliability signal, not a cosmetic one.
function estimateBpmPeakInterval(onsetEnv, hopSeconds, minBpm = 70, maxBpm = 190) {
  const n = onsetEnv.length;
  if (n < 8) return null;
  const mean = onsetEnv.reduce((a, b) => a + b, 0) / n;
  const variance = onsetEnv.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const thresh = mean + Math.sqrt(variance) * 0.5;
  const peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (onsetEnv[i] > thresh && onsetEnv[i] >= onsetEnv[i - 1] && onsetEnv[i] >= onsetEnv[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] > 2) peaks.push(i);
    }
  }
  if (peaks.length < 4) return null;
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median <= 0) return null;
  let bpm = 60 / (median * hopSeconds);
  // fold into the requested range by octave (double/half) before returning
  while (bpm < minBpm && bpm > 0) bpm *= 2;
  while (bpm > maxBpm) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

// tempo relation used by the legacy two-method BPM consensus (octave + 2:3 / 3:4 tolerant)
function bpmRelation(bpmA, bpmB, tolerancePct=3.0) {
  const ratios = [1.0, 2.0, 0.5, 1.5, 2/3, 0.75, 4/3];
  if (bpmA<=0||bpmB<=0) return {related:false, ratio:1, distPct:100};
  let bestRatio=1, bestDist=Infinity;
  for (const r of ratios) {
    const scaled = bpmB*r;
    const dist = Math.abs(scaled-bpmA)/bpmA*100;
    if (dist < bestDist) { bestDist = dist; bestRatio = r; }
  }
  return { related: bestDist <= tolerancePct, ratio: bestRatio, distPct: Math.round(bestDist*100)/100 };
}

// ---- BPM consensus: reconcile the two independent estimates ----
// Reuses bpmRelation (defined below) to check agreement across octave/
// triplet ratios, so 65 vs 130 BPM is recognized as agreement, not conflict.
// Falls back to the autocorrelation estimate alone (larger analysis window,
// generally the more robust of the two) when the peak-picking method could
// not produce a candidate, or when the two disagree even after tempo
// normalization — but a disagreement is reported honestly via reliability,
// never hidden.
function fuseBpm(bpmAutocorr, bpmPeakInterval) {
  if (bpmPeakInterval == null) {
    return {
      value: bpmAutocorr,
      reliability: 55,
      sources: ["legacy-autocorrelation"],
      candidates: { autocorrelation: bpmAutocorr, peakInterval: null },
      agreement: null,
    };
  }
  const rel = bpmRelation(bpmAutocorr, bpmPeakInterval, 4.0);
  const candidates = { autocorrelation: bpmAutocorr, peakInterval: bpmPeakInterval };
  if (rel.related) {
    // normalize the peak-interval estimate onto the autocorrelation octave, then blend
    const normalizedPeak = bpmPeakInterval * rel.ratio;
    const value = Math.round(((bpmAutocorr * 0.6) + (normalizedPeak * 0.4)) * 10) / 10;
    const reliability = Math.round(Math.max(60, 100 - rel.distPct * 6));
    return { value, reliability, sources: ["legacy-autocorrelation", "legacy-peak-interval"], candidates, agreement: rel };
  }
  // disagreement even after octave/triplet normalization — trust the
  // autocorrelation estimate but flag it as low-reliability rather than
  // silently presenting a single confident number
  return {
    value: bpmAutocorr,
    reliability: 40,
    sources: ["legacy-autocorrelation"],
    candidates,
    agreement: rel,
  };
}


// ---- Genre baseline profiles (ported from backend/app/audio/genre.py) ----
const GENRE_PROFILES = [
  ["House", [118,128], [20,55], [0.35,0.65], [0.35,0.7], [30,65], [10,50]],
  ["Tech House", [122,128], [25,60], [0.4,0.7], [0.45,0.8], [25,55], [5,30]],
  ["Deep House", [118,124], [15,45], [0.3,0.55], [0.4,0.75], [15,45], [10,45]],
  ["Electro", [125,132], [35,70], [0.45,0.75], [0.5,0.85], [40,75], [5,35]],
  ["Breakbeat", [125,140], [55,90], [0.55,0.85], [0.4,0.75], [35,70], [5,35]],
  ["UK Garage", [128,136], [55,90], [0.5,0.8], [0.45,0.8], [35,65], [15,55]],
  ["2-step", [128,136], [50,85], [0.45,0.75], [0.4,0.75], [30,60], [20,60]],
  ["Future Garage", [128,142], [35,65], [0.35,0.6], [0.5,0.85], [15,45], [15,55]],
  ["Jungle", [160,180], [65,95], [0.55,0.85], [0.5,0.85], [35,70], [5,35]],
  ["Drum & Bass", [160,178], [55,90], [0.55,0.85], [0.55,0.9], [35,75], [5,35]],
  ["Techno", [125,145], [25,60], [0.45,0.75], [0.5,0.85], [25,60], [0,20]],
  ["Acid Techno", [128,148], [35,70], [0.45,0.75], [0.5,0.85], [35,70], [0,15]],
  ["Electroclash", [118,132], [30,60], [0.35,0.65], [0.4,0.7], [35,70], [15,50]],
  ["Breaks", [125,140], [50,85], [0.5,0.8], [0.4,0.75], [35,70], [5,35]],
  ["Leftfield", [100,130], [30,65], [0.3,0.6], [0.3,0.65], [20,55], [5,40]],
  ["Downtempo", [70,100], [10,35], [0.15,0.4], [0.25,0.55], [10,35], [0,35]],
  ["Trip-Hop", [65,95], [15,40], [0.2,0.45], [0.35,0.65], [8,30], [10,45]],
  ["Ambient", [55,85], [2,14], [0.03,0.18], [0.05,0.3], [5,25], [0,10]],
  ["IDM", [95,150], [50,90], [0.35,0.65], [0.3,0.65], [30,65], [0,25]],
  ["Experimental", [70,145], [60,95], [0.15,0.4], [0.1,0.4], [15,50], [0,25]],
  ["Hip-Hop", [70,100], [20,55], [0.35,0.65], [0.5,0.85], [20,55], [30,75]],
  ["Rap", [70,100], [20,50], [0.3,0.6], [0.45,0.8], [20,55], [40,85]],
];

function rangeScore(v, lo, hi) {
  if (v >= lo && v <= hi) return 1.0;
  const span = Math.max(hi - lo, 1e-6);
  const dist = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - dist / span);
}

// How "tight" a genre's window is, per feature, versus a typical specific
// genre's window. A profile that spans almost the whole feature range (a
// catch-all like a loosely-defined "Experimental") would otherwise win by
// matching nearly everything at score 1.0 — this multiplies the raw match
// score down toward 0.6x the wider a profile's windows are, so a track only
// lands on a broad genre when it's a genuinely poor fit for every narrower,
// more specific one.
const GENRE_IDEAL_SPAN = { bpm: 12, rc: 25, perc: 0.28, bass: 0.32, bright: 28, vocal: 35 };
function specificityFactor(bpmR, rcR, percR, bassR, brightR, vocalR) {
  const s = (ideal, r) => Math.min(ideal / Math.max(r[1]-r[0], 1e-6), 1);
  const weighted =
    s(GENRE_IDEAL_SPAN.bpm, bpmR) * 0.30 +
    s(GENRE_IDEAL_SPAN.rc, rcR) * 0.20 +
    s(GENRE_IDEAL_SPAN.perc, percR) * 0.15 +
    s(GENRE_IDEAL_SPAN.bass, bassR) * 0.15 +
    s(GENRE_IDEAL_SPAN.bright, brightR) * 0.10 +
    s(GENRE_IDEAL_SPAN.vocal, vocalR) * 0.10;
  return 0.6 + 0.4 * weighted; // 0.6 (very broad profile) .. 1.0 (tight, specific profile)
}

function classifyGenre(bpm, rhythmicComplexity, percussiveRatio, bassEnergyNorm, brightness, vocalPresence) {
  const scored = GENRE_PROFILES.map(([name, bpmR, rcR, percR, bassR, brightR, vocalR]) => {
    const bpmCandidates = [bpm, bpm*2, bpm/2];
    const bpmScore = Math.max(...bpmCandidates.map(b => rangeScore(b, bpmR[0], bpmR[1])));
    const rcScore = rangeScore(rhythmicComplexity, rcR[0], rcR[1]);
    const percScore = rangeScore(percussiveRatio, percR[0], percR[1]);
    const bassScore = rangeScore(bassEnergyNorm, bassR[0], bassR[1]);
    const brightScore = rangeScore(brightness, brightR[0], brightR[1]);
    const vocalScore = rangeScore(vocalPresence, vocalR[0], vocalR[1]);
    const total = (bpmScore*0.30 + rcScore*0.20 + percScore*0.15 + bassScore*0.15 + brightScore*0.10 + vocalScore*0.10)
      * specificityFactor(bpmR, rcR, percR, bassR, brightR, vocalR);
    return [name, total];
  });
  scored.sort((a,b) => b[1]-a[1]);
  const raw = scored.map(s => s[1]);
  const mx = Math.max(...raw);
  let blended;
  if (mx > 0) {
    const sharp = raw.map(v => Math.exp((v-mx)*8.0));
    const sSum = sharp.reduce((a,b)=>a+b,0);
    const sMax = Math.max(...sharp);
    blended = sharp.map((v,i) => 0.5*(v/sMax) + 0.5*raw[i]);
  } else blended = raw;
  const normed = scored.map(([name], i) => [name, Math.round(Math.min(blended[i],0.99)*1000)/10]);
  const [primaryName, primaryConf] = normed[0];
  const secondary = normed.slice(1).filter(([,c]) => c >= 35).slice(0,4);
  return { primary: primaryName, confidence: primaryConf, secondary, method: "rule_based_baseline" };
}

// ---- Full per-track analysis over raw PCM (mono Float32Array) ----
function clip01to100(v, lo, hi) {
  if (hi <= lo) return 50;
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return Math.round(x * 1000) / 10;
}

function zeroCrossingRate(frame) {
  let c = 0;
  for (let i = 1; i < frame.length; i++) if ((frame[i] >= 0) !== (frame[i-1] >= 0)) c++;
  return c / frame.length;
}

function analyzeChannelData(channelData, sampleRate, opts = {}) {
  const maxSeconds = opts.maxSeconds || 90; // cap analysis window (MVP-in-browser scope)
  const N = Math.min(channelData.length, Math.floor(maxSeconds * sampleRate));
  const frameLen = 2048, hop = 1024;
  const win = hann(frameLen);

  const rmsEnv = [], centroids = [], rolloffs = [], zcrs = [];
  const bassE = [], midE = [], highE = [];
  const chromaAccum = new Float64Array(12);
  let frames = 0;

  for (let i = 0; i + frameLen <= N; i += hop) {
    const frame = channelData.subarray(i, i + frameLen);
    let sumSq = 0;
    for (let j = 0; j < frameLen; j++) sumSq += frame[j] * frame[j];
    const rms = Math.sqrt(sumSq / frameLen);
    rmsEnv.push(rms);
    zcrs.push(zeroCrossingRate(frame));

    const mag = magnitudeSpectrum(frame, win);
    const fftSize = mag.length * 2;

    // spectral centroid & rolloff
    let num = 0, den = 0, total = 0;
    for (let k = 0; k < mag.length; k++) { const f = (k * sampleRate) / fftSize; num += f * mag[k]; den += mag[k]; total += mag[k]; }
    centroids.push(den > 1e-9 ? num / den : 0);
    let cum = 0, rollBin = mag.length - 1;
    for (let k = 0; k < mag.length; k++) { cum += mag[k]; if (cum >= 0.85 * total) { rollBin = k; break; } }
    rolloffs.push((rollBin * sampleRate) / fftSize);

    // band energies (proportions of total spectral energy)
    let bass = 0, mid = 0, high = 0;
    for (let k = 0; k < mag.length; k++) {
      const f = (k * sampleRate) / fftSize;
      const e = mag[k] * mag[k];
      if (f >= 20 && f <= 250) bass += e;
      else if (f > 250 && f <= 2500) mid += e;
      else if (f > 2500 && f <= 8000) high += e;
    }
    const totalE = total * total + 1e-9;
    bassE.push(bass / totalE); midE.push(mid / totalE); highE.push(high / totalE);

    const chroma = binsToChroma(mag, sampleRate, fftSize);
    for (let c = 0; c < 12; c++) chromaAccum[c] += chroma[c];
    frames++;
  }

  const mean = arr => arr.reduce((a,b)=>a+b,0) / (arr.length || 1);
  const rmsMean = mean(rmsEnv);
  const rmsDbApprox = rmsEnv.map(v => 20 * Math.log10(v + 1e-9));
  rmsDbApprox.sort((a,b)=>a-b);
  const pct = (arr, p) => arr[Math.min(arr.length-1, Math.max(0, Math.floor(p*arr.length)))];
  const dynamicRangeDb = pct(rmsDbApprox, 0.95) - pct(rmsDbApprox, 0.05);

  // onset envelope (half-wave rectified energy diff) + BPM
  const onset = [0];
  for (let i = 1; i < rmsEnv.length; i++) onset.push(Math.max(0, rmsEnv[i] - rmsEnv[i-1]));
  const hopSeconds = hop / sampleRate;
  const bpmAutocorr = estimateBpm(onset, hopSeconds);
  const bpmPeakInterval = estimateBpmPeakInterval(onset, hopSeconds);
  const legacyBpmFusion = fuseBpm(bpmAutocorr, bpmPeakInterval);
  // Essentia.js (optional third source). opts.essentia is the result of
  // EssentiaLocal.analyze(); when absent/failed the legacy consensus is used as-is.
  const ess = opts.essentia && opts.essentia.status === "AVAILABLE" ? opts.essentia.result : null;
  const essRhythm = ess && ess.algorithms["RhythmExtractor2013"];
  const bpmFusion = (essRhythm && window.AnalysisFusion)
    ? AnalysisFusion.fuseBpm3(legacyBpmFusion, { bpm: essRhythm.bpm, confidence: essRhythm.confidence })
    : legacyBpmFusion;
  const bpm = bpmFusion.value;
  const onsetDensityPerSec = (onset.filter(v => v > mean(onset)*1.5).length) / (N / sampleRate);

  // tempo stability: coefficient of variation of onset-envelope peak spacing (rough proxy)
  const peakLags = [];
  const thresh = mean(onset) + Math.sqrt(mean(onset.map(v=>(v-mean(onset))**2)));
  let lastPeak = -1;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > thresh && onset[i] >= onset[i-1] && onset[i] >= onset[i+1]) {
      if (lastPeak >= 0) peakLags.push(i - lastPeak);
      lastPeak = i;
    }
  }
  let tempoStability = 50;
  if (peakLags.length >= 3) {
    const m = mean(peakLags);
    const sd = Math.sqrt(mean(peakLags.map(v => (v-m)**2)));
    const cv = sd / (m + 1e-9);
    tempoStability = Math.round(Math.max(0, Math.min(100, 100*(1-Math.min(cv,1)))) * 10) / 10;
  }

  // rhythmic complexity: normalized entropy of onset-envelope histogram
  const bins = 32;
  const omax = Math.max(...onset, 1e-9);
  const hist = new Array(bins).fill(0);
  for (const v of onset) hist[Math.min(bins-1, Math.floor((v/omax)*bins))]++;
  const histNorm = hist.map(h => h / onset.length).filter(h => h > 0);
  const entropy = -histNorm.reduce((s,p) => s + p*Math.log2(p), 0);
  const rhythmicComplexity = clip01to100(entropy, 0, Math.log2(bins));

  // key
  const legacyKey = estimateKey(chromaAccum);
  const essKeys = ess ? Object.entries(ess.algorithms).filter(([n]) => n.startsWith("KeyExtractor:"))
    .map(([n, v]) => ({ profile: n.split(":")[1], key: v.key, scale: v.scale, strength: v.strength })) : [];
  const keyFusion = (essKeys.length && window.AnalysisFusion) ? AnalysisFusion.fuseKey(legacyKey, essKeys) : null;
  const key = keyFusion ? keyFusion.key : legacyKey;
  const chromaMean = Array.from(chromaAccum).map(v => v / (frames || 1));
  const chromaNorm = norm(chromaMean);
  const chromaProb = chromaNorm.map(v => Math.abs(v));
  const cSum = chromaProb.reduce((a,b)=>a+b,0) || 1;
  const chromaEntropy = -chromaProb.reduce((s,p) => { const pp = p/cSum; return s + (pp>0? pp*Math.log2(pp):0); }, 0);

  const spectralCentroidMean = mean(centroids);
  const spectralRolloffMean = mean(rolloffs);
  const zcrMean = mean(zcrs);
  const bassEnergyNorm = mean(bassE);
  const midEnergyNorm = mean(midE);
  const highEnergyNorm = mean(highE);

  // proxies (explicitly approximated, no stem separation / HPSS in-browser)
  const percussiveRatio = clip01to100(mean(onset) / (rmsMean + 1e-9), 0, 3) / 100; // 0-1
  const drumBandEnergyProxy = clip01to100(highEnergyNorm * percussiveRatio, 0, 0.3) / 100;
  const vocalPresenceEstimate = clip01to100(midEnergyNorm * (1 - percussiveRatio) * 3, 0, 1);

  const brightness = clip01to100(spectralCentroidMean, 800, 6000);
  const darkness = Math.round((100 - brightness) * 10) / 10;
  const energy = clip01to100(rmsMean, 0.01, 0.35);
  const tempoInRange = clip01to100(-Math.abs(bpm - 126), -60, 0);
  let danceability = 0.4*tempoStability + 0.35*(percussiveRatio*100) + 0.25*tempoInRange;
  danceability = Math.round(Math.max(0, Math.min(100, danceability)) * 10) / 10;

  const drumDensity = clip01to100(drumBandEnergyProxy, 0, 0.4);
  const bassDensity = clip01to100(bassEnergyNorm, 0, 0.5);
  const melodicDensity = clip01to100((1-percussiveRatio) * (chromaEntropy/Math.log2(12)), 0, 0.9);
  const harmonicComplexity = clip01to100(chromaEntropy, 1.5, Math.log2(12));
  const acousticness = clip01to100((1-percussiveRatio) - zcrMean*2, -0.3, 0.7);
  const electronicness = Math.round((100-acousticness)*10)/10;
  const texture = clip01to100(spectralRolloffMean/6000 + (Math.abs(highEnergyNorm-bassEnergyNorm))*2, 0.1, 1.6);

  const profile = {
    bpm, energy, danceability, rhythmicComplexity, melodicDensity, harmonicComplexity,
    drumDensity, bassDensity, vocalPresence: vocalPresenceEstimate, brightness, darkness,
    acousticness, electronicness, dynamicRange: clip01to100(dynamicRangeDb, 3, 25),
    tempoStability, texture,
  };

  const genre = classifyGenre(bpm, rhythmicComplexity, percussiveRatio, bassEnergyNorm, brightness, vocalPresenceEstimate);

  // ---- structure (spec section 13): downsampled energy curve + intro/outro estimate ----
  const normRms = rmsEnv.map(v => v / (Math.max(...rmsEnv, 1e-9)));
  const fullEnergyThreshold = 0.6;
  const sustainFrames = Math.max(1, Math.round(2.0 / hopSeconds));
  let introSec = null, outroSec = null, run = 0;
  for (let i = 0; i < normRms.length; i++) {
    run = normRms[i] > fullEnergyThreshold ? run + 1 : 0;
    if (run >= sustainFrames) { introSec = Math.round((i - sustainFrames + 1) * hopSeconds * 10) / 10; break; }
  }
  run = 0;
  for (let i = normRms.length - 1; i >= 0; i--) {
    run = normRms[i] > fullEnergyThreshold ? run + 1 : 0;
    if (run >= sustainFrames) { outroSec = Math.round(((N/sampleRate) - i * hopSeconds) * 10) / 10; break; }
  }
  const dsStep = Math.max(1, Math.round(rmsEnv.length / 120));
  const energyCurve = []; for (let i = 0; i < rmsEnv.length; i += dsStep) energyCurve.push(Math.round(normRms[i] * 1000) / 1000);
  const structure = { introSec, outroSec, energyCurve };


  // grouped feature vectors for the similarity engine (mirrors pipeline.py)
  const genreVec = GENRE_PROFILES.map(([name]) => name === genre.primary ? 1.0 : 0.0);
  for (const [name, conf] of genre.secondary) {
    const idx = GENRE_PROFILES.findIndex(p => p[0] === name);
    if (idx >= 0) genreVec[idx] = conf/100;
  }
  const rhythmVec = norm([rhythmicComplexity/100, Math.min(1,onsetDensityPerSec/15), tempoStability/100, percussiveRatio]);
  const drumsVec = norm([drumBandEnergyProxy, percussiveRatio]);
  const bassVec = norm([bassEnergyNorm]);
  const melodyVec = norm([melodicDensity/100, chromaEntropy/Math.log2(12)]);
  const harmonyVec = norm([...chromaMean, harmonicComplexity/100]);
  const energyVec = norm([energy/100, dynamicRangeDb/25, (rmsEnv.length? Math.sqrt(mean(rmsEnv.map(v=>(v-rmsMean)**2)))/(rmsMean+1e-9):0)/3]);
  const textureVec = norm([spectralCentroidMean/8000, spectralRolloffMean/8000, zcrMean*10, texture/100]);

  return {
    bpm, key, genre, profile, structure,
    duration: N / sampleRate,
    analyzedSeconds: N / sampleRate,
    truncated: N < channelData.length,
    featureGroups: {
      genre: genreVec, rhythm: rhythmVec, drums: drumsVec, bass: bassVec,
      melody: melodyVec, harmony: harmonyVec, energy: energyVec, texture: textureVec,
    },
    unknownFields: ["time signature", "точное разделение на инструменты (стемы)"],
    // ---- Track Profile v2: structured analysis metadata (additive, doesn't
    // replace the flat fields above — every existing call site that reads
    // t.bpm / t.key / t.genre keeps working unchanged) ----
    analysis: {
      version: 2,
      status: "LOCAL_ANALYSIS",
      sources: keyFusion ? Array.from(new Set([...bpmFusion.sources, ...keyFusion.sources])) : bpmFusion.sources,
      bpm: { value: bpm, reliability: bpmFusion.reliability, candidates: bpmFusion.candidates,
             modelConfidence: bpmFusion.modelConfidence ?? null },
      key: { value: key.camelot, reliability: keyFusion ? keyFusion.reliability : legacyKey.confidence,
             agreement: keyFusion ? keyFusion.agreement : null,
             modelStrength: keyFusion ? keyFusion.modelStrength : null,
             legacyCamelot: legacyKey.camelot },
      // raw scalar inputs behind genre classification, kept so a manual BPM
      // override can recompute genre without a full re-analysis pass
      genreInputs: { percussiveRatio, bassEnergyNorm, brightness, vocalPresence: vocalPresenceEstimate },
      // Compact Essentia.js aggregates only (no beat arrays / frames in localStorage).
      essentia: ess ? {
        version: ess.version,
        rhythm: essRhythm ? { bpm: essRhythm.bpm, confidence: essRhythm.confidence, beatCount: essRhythm.beatCount,
                              beatIntervalCv: essRhythm.beatIntervalCv, firstBeatSec: essRhythm.firstBeatSec } : null,
        keys: essKeys,
        danceability: ess.algorithms["Danceability"] ? ess.algorithms["Danceability"].value : null,
        onsetRate: ess.algorithms["OnsetRate"] ? ess.algorithms["OnsetRate"].onsetRate : null,
        errors: Object.keys(ess.errors).length ? ess.errors : null,
      } : null,
      advanced: ess
        ? { status: "AVAILABLE", engine: "essentia.js (Essentia " + ess.version + ")", scope: "local (browser, WASM)",
            algorithms: Object.keys(ess.algorithms) }
        : { status: opts.essentia ? opts.essentia.status : "UNAVAILABLE",
            reason: opts.essentia ? opts.essentia.reason : "essentia.js was not run" },
    },
  };
}



