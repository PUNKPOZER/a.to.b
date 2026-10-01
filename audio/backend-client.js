/* Client for the optional FastAPI + Essentia backend (window.BackendClient).
 * The URL is configuration, never hard-coded for production:
 *   1. localStorage "ts_api_url" (set in Settings), else
 *   2. window.SELECTOR_CONFIG.apiUrl (optional config.js), else
 *   3. http://localhost:8000 when the page itself is served from localhost, else "" (disabled).
 * Every call resolves — a dead backend never throws into the app. */
(function () {
  function apiUrl() {
    let u = "";
    try { u = localStorage.getItem("ts_api_url") || ""; } catch (e) {}
    if (!u && window.SELECTOR_CONFIG && window.SELECTOR_CONFIG.apiUrl) u = window.SELECTOR_CONFIG.apiUrl;
    if (!u && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) u = "http://localhost:8000";
    return u.replace(/\/+$/, "");
  }
  async function fetchT(url, opts, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
  }
  async function health() {
    const base = apiUrl();
    if (!base) return { online: false, reason: "backend URL not configured" };
    try {
      const r = await fetchT(base + "/api/health", {}, 4000);
      if (!r.ok) return { online: false, reason: "HTTP " + r.status };
      return { online: true, info: await r.json() };
    } catch (e) { return { online: false, reason: "unreachable" }; }
  }
  async function analyze(file) {
    const base = apiUrl();
    if (!base) return { ok: false, reason: "backend URL not configured" };
    try {
      const fd = new FormData(); fd.append("file", file, file.name);
      const r = await fetchT(base + "/api/analyze", { method: "POST", body: fd }, 10 * 60 * 1000);
      if (!r.ok) { let d = ""; try { d = (await r.json()).detail || ""; } catch (e) {} return { ok: false, reason: "HTTP " + r.status + (d ? ": " + d : "") }; }
      return { ok: true, result: await r.json() };
    } catch (e) { return { ok: false, reason: e.name === "AbortError" ? "timeout" : "backend unreachable" }; }
  }
  async function structure(file) {
    const base = apiUrl();
    if (!base) return { ok: false, reason: "backend URL not configured" };
    try {
      const fd = new FormData(); fd.append("file", file, file.name);
      const r = await fetchT(base + "/api/structure", { method: "POST", body: fd }, 20 * 60 * 1000);
      if (!r.ok) { let d = ""; try { d = (await r.json()).detail || ""; } catch (e) {} return { ok: false, unavailable: r.status === 503, reason: "HTTP " + r.status + (d ? ": " + d : "") }; }
      return { ok: true, result: await r.json() };
    } catch (e) { return { ok: false, reason: e.name === "AbortError" ? "timeout" : "backend unreachable" }; }
  }
  async function embed(file) {
    const base = apiUrl();
    if (!base) return { ok: false, reason: "backend URL not configured" };
    try {
      const fd = new FormData(); fd.append("file", file, file.name);
      const r = await fetchT(base + "/api/embed", { method: "POST", body: fd }, 20 * 60 * 1000);
      if (!r.ok) { let d = ""; try { d = (await r.json()).detail || ""; } catch (e) {} return { ok: false, unavailable: r.status === 503, reason: "HTTP " + r.status + (d ? ": " + d : "") }; }
      return { ok: true, result: await r.json() };
    } catch (e) { return { ok: false, reason: e.name === "AbortError" ? "timeout" : "backend unreachable" }; }
  }
  async function postJson(path, body, ms = 60000) {
    const base = apiUrl();
    if (!base) return { ok: false, reason: "backend URL not configured" };
    try {
      const r = await fetchT(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ms);
      if (!r.ok) { let d = ""; try { d = (await r.json()).detail || ""; } catch (e) {} return { ok: false, reason: "HTTP " + r.status + (d ? ": " + d : "") }; }
      return { ok: true, result: await r.json() };
    } catch (e) { return { ok: false, reason: "backend unreachable" }; }
  }
  window.BackendClient = { apiUrl, health, analyze, structure, embed,
    sonicPairwise: (ids) => postJson("/api/sonic/pairwise", { ids }),
    sonicBridge: (a, b, candidates) => postJson("/api/sonic/bridge", { a, b, candidates }),
    sonicRecalibrate: (ids) => postJson("/api/sonic/recalibrate", { ids }) };
})();
