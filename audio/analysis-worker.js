/* Heavy audio maths off the UI thread: mono mix-down, the local DSP analysis (engine/core.js), the waveform and the local bar grid.
 * Messages: { id, op: "mono" | "analyze" | "grid", ... } -> { id, ok, ... }. Large arrays are transferred, not copied. */
self.window = self;
importScripts("analysis-fusion.js", "waveform.js", "local-grid.js", "../engine/core.js");
function mix(channels) {
  const n = channels[0].length, mono = new Float32Array(n), k = channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / k;
  return mono;
}
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.op === "mono") { const mono = mix(m.channels); self.postMessage({ id: m.id, ok: true, mono }, [mono.buffer]); }
    else if (m.op === "analyze") {
      const result = analyzeChannelData(m.mono, m.sr, { maxSeconds: m.maxSeconds, essentia: m.essentia });
      const waveform = Waveform.encode(Waveform.compute(m.mono, m.sr));
      self.postMessage({ id: m.id, ok: true, result, waveform });
    }
    else if (m.op === "grid") self.postMessage({ id: m.id, ok: true, grid: LocalGrid.analyze(m.mono, m.sr, m.bpm) });
    else self.postMessage({ id: m.id, ok: false, error: "unknown op" });
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
