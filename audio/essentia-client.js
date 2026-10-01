/* Main-thread client for the Essentia.js worker. Exposes window.EssentiaLocal.
 * Never throws into the app: analyze() always resolves with
 * { status: "AVAILABLE" | "UNAVAILABLE" | "ERROR", reason?, result? }.
 * If the worker/WASM can't load (offline, file://, old browser) the app
 * simply keeps its legacy analysis. */
(function () {
  const TARGET_SR = 44100;
  const TIMEOUT_MS = 90000;
  let worker = null, seq = 0, broken = null;
  const pending = new Map();

  function getWorker() {
    if (broken) return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL("audio/essentia-worker.js", document.baseURI).href);
      worker.onmessage = (ev) => {
        const m = ev.data; if (!m || m.id == null) return;
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); clearTimeout(p.timer); p.resolve(m);
      };
      worker.onerror = (e) => {
        broken = "worker failed to load: " + (e.message || "unknown error");
        pending.forEach((p) => { clearTimeout(p.timer); p.resolve({ ok: false, error: broken }); });
        pending.clear(); worker = null;
      };
    } catch (e) { broken = "Web Worker unavailable: " + e.message; worker = null; }
    return worker;
  }

  // Resample mono PCM to 44.1 kHz (Essentia's rhythm algorithms assume it).
  async function toMono44k(mono, sampleRate) {
    if (sampleRate === TARGET_SR) return mono;
    const len = Math.ceil(mono.length * TARGET_SR / sampleRate);
    const ctx = new OfflineAudioContext(1, len, TARGET_SR);
    const buf = ctx.createBuffer(1, mono.length, sampleRate);
    buf.copyToChannel(mono, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }

  async function analyze(mono, sampleRate, maxSeconds) {
    const w = getWorker();
    if (!w) return { status: "UNAVAILABLE", reason: broken || "worker unavailable" };
    try {
      const n = Math.min(mono.length, Math.floor(maxSeconds * sampleRate));
      const samples = (await toMono44k(mono.slice(0, n), sampleRate)).slice();
      const id = ++seq;
      const reply = await new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timeout" }); }, TIMEOUT_MS);
        pending.set(id, { resolve, timer });
        w.postMessage({ id, samples }, [samples.buffer]);
      });
      if (!reply.ok) return { status: "ERROR", reason: reply.error };
      const r = reply.result;
      if (!r.algorithms["RhythmExtractor2013"] && !r.algorithms["KeyExtractor:bgate"]) {
        return { status: "ERROR", reason: "no algorithm succeeded: " + JSON.stringify(r.errors) };
      }
      return { status: "AVAILABLE", result: r };
    } catch (e) { return { status: "ERROR", reason: String(e && e.message || e) }; }
  }

  window.EssentiaLocal = { analyze };
})();
