/* NOESIS UI primitives — small, reusable, side-effect free HTML builders (namespace `UI`).
 * Pages are composed from these; none of them reads global state except through arguments. */
const UI = (() => {
  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const NA = "—";

  /* ---- one icon family: 16px grid, 1.25 stroke, square caps ---- */
  const P = {
    play: '<path d="M4.5 3 13 8l-8.5 5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M4 3v10M13 3 6 8l7 5z"/>', next: '<path d="M12 3v10M3 3l7 5-7 5z"/>',
    shuffle: '<path d="M2 4h3l6 8h3M2 12h3l2-2.7M9 6.7 11 4h3M12 2l2 2-2 2M12 10l2 2-2 2"/>',
    repeat: '<path d="M3 7V6a2 2 0 0 1 2-2h8l-2-2M13 9v1a2 2 0 0 1-2 2H3l2 2"/>',
    volume: '<path d="M2 6h3l4-3v10l-4-3H2zM11.5 5.5a3.5 3.5 0 0 1 0 5"/>',
    queue: '<path d="M2 4h9M2 8h9M2 12h5M12 10v4M10 12h4"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
    menu: '<path d="M2 4h12M2 8h12M2 12h12"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    folder: '<path d="M1.5 4.5h4l1.5 1.5h7.5v7h-13z"/>',
    plus: '<path d="M8 3v10M3 8h10"/>', more: '<circle cx="3.5" cy="8" r="0.9" fill="currentColor"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/><circle cx="12.5" cy="8" r="0.9" fill="currentColor"/>',
    close: '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>', panel: '<path d="M2 3h12v10H2zM10 3v10"/>',
    arrow: '<path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6"/>',
  };
  const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${P[n] || ""}</svg>`;

  /* ---- NOESIS mark (assets/logo.svg): the silhouette stays near-black, the detail takes the text colour ---- */
  const logo = (size = 26) => `<svg class="mark" height="${size}" width="${Math.round(size * 663 / 640)}" viewBox="0 0 663 640" fill="none" role="img" aria-label="NOESIS"><path d="${LOGO_SILHOUETTE}" fill="#000"/><path fill-rule="evenodd" clip-rule="evenodd" d="${LOGO_DETAIL}" fill="currentColor"/></svg>`;

  /* ---- artwork: embedded cover when the file has one, else a deterministic geometric placeholder ---- */
  function art(t, cls = "") {
    if (t && t.cover) return `<img class="art ${cls}" src="${t.cover}" alt="" loading="lazy">`;
    let h = 0; const s = (t && (t.hash || t.id)) || "x";
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const r = (n) => { h = (h * 1103515245 + 12345) >>> 0; return h % n; };
    let g = "";
    for (let i = 0; i < 5; i++) { const x = 4 + r(40), w = 3 + r(10); g += `<rect x="${x}" y="${6 + r(10)}" width="${1 + r(2)}" height="${10 + r(30)}" fill="#f1f0eb" opacity="${(0.15 + r(40) / 100).toFixed(2)}"/>`; }
    const c = `<circle cx="${14 + r(20)}" cy="${14 + r(20)}" r="${6 + r(10)}" fill="none" stroke="#f1f0eb" stroke-opacity=".3"/>`;
    return `<svg class="art ${cls}" viewBox="0 0 48 48" role="img" aria-label="no cover"><rect width="48" height="48" fill="#101111"/>${c}${g}</svg>`;
  }

  const sectionHead = (label, right = "") => `<div class="section-head"><span class="label">${label}</span><span class="mono dim">${right}</span></div>`;

  const metric = (label, value, sub = "", extra = "") => `<div class="metric"><div class="label">${esc(label)}</div><div class="v">${value}</div><div class="s">${sub}</div>${extra}</div>`;

  const tone = (v) => (v == null ? "lo" : v >= 80 ? "hi" : v >= 55 ? "mid" : "lo");
  // Sonic similarity and DJ compatibility are two different questions — never merged into one number.
  const score = (kind, v) => `<span class="scoretag ${kind === "sonic" ? "sonicv" : "djv"}" title="${kind === "sonic" ? "Sonic similarity" : "DJ compatibility"}"><b class="${tone(v)} num">${v == null ? NA : Math.round(v) + "%"}</b><span>${kind === "sonic" ? "Sonic" : "DJ"}</span></span>`;

  /* ---- analysis status: small dots, no spinners ---- */
  function statusDots(t) {
    const an = t && t.analysis; if (!an) return `<div class="status"><span class="s todo"><i class="dot"></i>Legacy analysis</span></div>`;
    const busy = an.status;
    const st = (done, running, failed) => failed ? "fail" : done ? "done" : running ? "run" : "todo";
    const bAvail = an.backend && an.backend.status === "AVAILABLE";
    const items = [
      ["Local", st(true, false, false)],
      ["Essentia", st(bAvail, busy === "ADVANCED_ANALYSIS", an.backend && an.backend.status === "ERROR" || busy === "FAILED")],
      ["Structure", st(an.structure && an.structure.status === "AVAILABLE", busy === "STRUCTURE_ANALYSIS", an.structure && an.structure.status === "ERROR")],
      ["Embedding", st(an.sonic && an.sonic.status === "AVAILABLE", busy === "SONIC_EMBEDDING", an.sonic && an.sonic.status === "ERROR")],
    ];
    return `<div class="status" role="status" aria-label="Analysis status">${items.map(([n, s]) => `<span class="s ${s}"><i class="dot"></i>${n}<span class="sr-only"> ${s}</span></span>`).join("")}</div>`;
  }
  function statusWord(t) {
    const an = t && t.analysis; if (!an) return "Legacy";
    return { LOCAL_ANALYSIS: "Local", ADVANCED_ANALYSIS: "Advanced…", STRUCTURE_ANALYSIS: "Structure…", SONIC_EMBEDDING: "Embedding…", COMPLETE: "Complete", FAILED: "Failed" }[an.status] || an.status;
  }

  /* ---- thin monochrome Camelot ring: outer = major (B), inner = minor (A); the active key is a filled dot ---- */
  function camelotRing(code, size = 64) {
    const c = size / 2, ro = size / 2 - 4, ri = ro * 0.64;
    let d = "";
    for (let i = 1; i <= 12; i++) {
      const a = ((i - 3) / 12) * Math.PI * 2;
      for (const [letter, r] of [["B", ro], ["A", ri]]) {
        const on = code === i + letter, x = (c + r * Math.cos(a)).toFixed(1), y = (c + r * Math.sin(a)).toFixed(1);
        d += on ? `<circle cx="${x}" cy="${y}" r="3.4" fill="#f1f0eb"/>` : `<circle cx="${x}" cy="${y}" r="1.2" fill="#5d5e5a"/>`;
      }
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Camelot ${esc(code || "unknown")}"><circle cx="${c}" cy="${c}" r="${ro}" fill="none" stroke="#2a2b2a" stroke-width=".8"/><circle cx="${c}" cy="${c}" r="${ri}" fill="none" stroke="#2a2b2a" stroke-width=".8"/>${d}</svg>`;
  }

  /* ---- tiny graphs (accent colour allowed, chrome stays monochrome) ---- */
  function sparkline(values, color = "#9b9a94", h = 40) {
    if (!values || values.length < 2) return `<div class="mono faint" style="height:${h}px">${NA}</div>`;
    const n = values.length, w = 200, mx = Math.max(...values, 1e-9), mn = Math.min(...values, 0);
    const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2" vector-effect="non-scaling-stroke"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}" fill-opacity=".08" stroke="none"/></svg>`;
  }
  const bar = (pct, color = "") => `<div class="bar" role="img" aria-label="${Math.round(pct)}%"><i style="width:${Math.max(0, Math.min(100, pct))}%;${color ? "background:" + color : ""}"></i></div>`;
  const feature = (label, valueText, graphHtml) => `<div class="feat"><div class="head"><span class="label">${esc(label)}</span><span class="mono dim">${valueText}</span></div>${graphHtml}</div>`;

  /* ---- compact vertical-list row used by the context panel ---- */
  function trackRow(t, { scoreHtml = "", sub = "", reasons = "", playable = true } = {}) {
    const meta = [t.genre && t.genre.primary, t.bpm != null ? t.bpm.toFixed(1) + " BPM" : null, t.key && t.key.camelot].filter(Boolean).join(" · ");
    const playing = typeof player !== "undefined" && player.id === t.id && !player.audio.paused;
    return `<div class="trow" data-open-track="${t.id}">
      <span class="artplay">${art(t, "sm")}${playable ? `<button class="ov ${playing ? "on" : ""}" data-simplay="${t.id}" aria-label="Play preview">${icon(playing ? "pause" : "play")}</button>` : ""}</span>
      <div style="min-width:0"><div class="t2">${esc(t.artist)}</div><div class="t1">${esc(t.title)}</div><div class="t3">${esc(meta)}</div>${reasons}</div>
      <div class="sc">${scoreHtml}${sub ? `<div class="sub">${sub}</div>` : ""}</div></div>`;
  }

  const seg = (opts, cur, attr) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${String(v) === String(cur) ? "on" : ""}" ${attr}="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;

  return { esc, NA, icon, logo, art, sectionHead, metric, tone, score, statusDots, statusWord, camelotRing, sparkline, bar, feature, trackRow, seg };
})();
