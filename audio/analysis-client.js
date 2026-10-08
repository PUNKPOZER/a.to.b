/* Main-thread client for audio/analysis-worker.js (window.AnalysisWorker). One worker, requests handled in order. */
(function () {
  let worker = null, seq = 0; const pending = new Map();
  function get() {
    if (worker) return worker;
    worker = new Worker(new URL("audio/analysis-worker.js", document.baseURI).href);
    worker.onmessage = (ev) => { const m = ev.data, p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.ok ? p.resolve(m) : p.reject(new Error(m.error || "analysis failed")); };
    worker.onerror = (e) => { const err = new Error("analysis worker failed: " + (e.message || "unknown")); pending.forEach((p) => p.reject(err)); pending.clear(); worker = null; };
    return worker;
  }
  const call = (msg, transfer) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); get().postMessage({ ...msg, id }, transfer || []); });
  // channels: Float32Array[] (they are transferred: pass copies)
  window.AnalysisWorker = {
    mono: async (channels) => (await call({ op: "mono", channels }, channels.map((c) => c.buffer))).mono,
    analyze: (mono, sr, essentia, maxSeconds) => call({ op: "analyze", mono, sr, essentia, maxSeconds }, [mono.buffer]),
    grid: async (mono, sr, bpm) => (await call({ op: "grid", mono, sr, bpm }, [mono.buffer])).grid,
  };
})();
