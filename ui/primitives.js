/* a.to.b UI primitives — small, reusable, side-effect free HTML builders (namespace `UI`).
 * Views are composed from these. Text always goes through t() (app/i18n.js). */
const UI = (() => {
  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const NA = "—";

  /* ---- one icon family: 16px grid, 1.3 stroke ---- */
  const P = {
    play: '<path d="M4.5 2.8 13 8l-8.5 5.2z" fill="currentColor" stroke="none"/>', pause: '<path d="M4.5 3h2.7v10H4.5zM8.8 3h2.7v10H8.8z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M4 3v10M13 3 6 8l7 5z"/>', next: '<path d="M12 3v10M3 3l7 5-7 5z"/>',
    shuffle: '<path d="M2 4h3l6 8h3M2 12h3l2-2.7M9 6.7 11 4h3M12 2l2 2-2 2M12 10l2 2-2 2"/>', repeat: '<path d="M3 7V6a2 2 0 0 1 2-2h8l-2-2M13 9v1a2 2 0 0 1-2 2H3l2 2"/>',
    volume: '<path d="M2 6h3l4-3v10l-4-3H2zM11.5 5.5a3.5 3.5 0 0 1 0 5"/>', queue: '<path d="M2 4h9M2 8h9M2 12h5M12 10v4M10 12h4"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    folder: '<path d="M1.5 4.5h4l1.5 1.5h7.5v7h-13z"/>', plus: '<path d="M8 3v10M3 8h10"/>', more: '<circle cx="3.5" cy="8" r="0.9" fill="currentColor"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/><circle cx="12.5" cy="8" r="0.9" fill="currentColor"/>',
    close: '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>', arrow: '<path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6"/>', chev: '<path d="m4 6 4 4 4-4"/>', check: '<path d="m3 8.5 3 3 7-7.5"/>',
    grip: '<circle cx="6" cy="4" r="1" fill="currentColor"/><circle cx="10" cy="4" r="1" fill="currentColor"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>', unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"/>',
    swap: '<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>', download: '<path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/>', up: '<path d="m4 10 4-4 4 4"/>',
    wave: '<path d="M2 8v0M4.5 5v6M7 2.5v11M9.5 5.5v5M12 4v8M14 7v2"/>', search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>', bolt: '<path d="M9 1.5 3.5 9h4l-1 5.5L12.5 7h-4z"/>',
  };
  const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;

  /* ---- brand: the approved a.to.b wordmark (single path, currentColor) ---- */
  const logo = (h = 30) => `<svg class="logo" viewBox="0 0 448 175" height="${h}" width="${Math.round((h * 448) / 175)}" role="img" aria-label="a.to.b" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="${LOGO_PATH}"/></svg>`;
  const swirl = () => `<svg class="swirl" viewBox="0 0 448 175" aria-hidden="true" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="${LOGO_PATH}"/></svg>`;
  const mark = (h = 22) => `<svg viewBox="0 0 ${MARK_BOX[0]} ${MARK_BOX[1]}" height="${h}" width="${Math.round(h * MARK_BOX[0] / MARK_BOX[1])}" aria-hidden="true" fill="none"><path d="${MARK_PATH}" fill="currentColor"/></svg>`;

  /* ---- artwork: the file's embedded cover, else a deterministic geometric placeholder ---- */
  function art(tr, cls = "") {
    if (tr && tr.cover) return `<img class="art ${cls}" src="${tr.cover}" alt="" loading="lazy">`;
    let h = 0; const s = (tr && (tr.hash || tr.id)) || "x";
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const r = (n) => { h = (h * 1103515245 + 12345) >>> 0; return h % n; };
    let g = ""; for (let i = 0; i < 5; i++) g += `<rect x="${4 + r(40)}" y="${6 + r(10)}" width="${1 + r(2)}" height="${10 + r(30)}" fill="#f4f4f2" opacity="${(0.15 + r(40) / 100).toFixed(2)}"/>`;
    return `<svg class="art ${cls}" viewBox="0 0 48 48" role="img" aria-label="${esc(t("track.noCover"))}"><rect width="48" height="48" fill="#131313"/><circle cx="${14 + r(20)}" cy="${14 + r(20)}" r="${6 + r(10)}" fill="none" stroke="#f4f4f2" stroke-opacity=".3"/>${g}</svg>`;
  }

  // Camelot key as a colour-coded badge (the wheel position is the hue, so neighbouring keys look related)
  const keyColor = (code) => { const m = /^(\d{1,2})([AB])$/.exec(code || ""); if (!m) return null; const h = ((+m[1] - 1) * 30 + 200) % 360; return m[2] === "A" ? `hsl(${h} 62% 70%)` : `hsl(${h} 78% 62%)`; };
  const keyBadge = (code) => { const c = keyColor(code); return c ? `<span class="kb" style="background:${c}">${esc(code)}</span>` : `<span class="kb none">${NA}</span>`; };
  const tone = (v) => (v == null ? "none" : v >= 80 ? "good" : v >= 55 ? "mid" : "bad");
  const pct = (v) => (v == null ? NA : Math.round(v) + "%");
  const score = (kind, v) => `<span class="scoretag" title="${esc(t(kind === "sonic" ? "score.sonic" : "score.dj"))}"><b class="${tone(v)} num">${pct(v)}</b><span>${esc(t(kind === "sonic" ? "score.sonicShort" : "score.djShort"))}</span></span>`;
  const badge = (kind, labelKey) => `<span class="badge ${kind}">${esc(t(labelKey))}</span>`;

  /* ---- analysis stages: four independent outlined controls (no chains) ---- */
  function stages(tr) {
    const an = tr && tr.analysis, busy = an && an.status;
    const st = (done, running, failed, unavailable) => failed ? "fail" : done ? "done" : running ? "run" : unavailable ? "todo" : "todo";
    const bk = an && an.backend, sx = an && an.structure, so = an && an.sonic;
    const items = [
      ["local", an ? "done" : "todo", an ? "stage.localDone" : "stage.localNone"],
      ["essentia", st(bk && bk.status === "AVAILABLE", busy === "ADVANCED_ANALYSIS", bk && bk.status === "ERROR", bk && bk.status === "UNAVAILABLE"), bk && bk.status === "AVAILABLE" ? "stage.essentiaDone" : bk && bk.status === "UNAVAILABLE" ? "stage.essentiaUnavailable" : bk && bk.status === "ERROR" ? "stage.error" : busy === "ADVANCED_ANALYSIS" ? "stage.running" : "stage.notRun"],
      ["structure", st(sx && sx.status === "AVAILABLE", busy === "STRUCTURE_ANALYSIS", sx && sx.status === "ERROR", sx && sx.status === "UNAVAILABLE"), sx && sx.status === "AVAILABLE" ? "stage.structureDone" : sx && sx.status === "UNAVAILABLE" ? "stage.structureUnavailable" : sx && sx.status === "ERROR" ? "stage.error" : busy === "STRUCTURE_ANALYSIS" ? "stage.running" : "stage.notRun"],
      ["embedding", st(so && so.status === "AVAILABLE", busy === "SONIC_EMBEDDING", so && so.status === "ERROR", so && so.status === "UNAVAILABLE"), so && so.status === "AVAILABLE" ? "stage.embeddingDone" : so && so.status === "UNAVAILABLE" ? "stage.embeddingUnavailable" : so && so.status === "ERROR" ? "stage.error" : busy === "SONIC_EMBEDDING" ? "stage.running" : "stage.notRun"],
    ];
    const reason = (key) => { const o = key === "essentia" ? bk : key === "structure" ? sx : key === "embedding" ? so : null; return o && o.reason ? " — " + o.reason : ""; };
    return `<div class="stages" role="list" aria-label="${esc(t("stage.title"))}">${items.map(([k, s, d]) => `<button type="button" class="stage ${s}" role="listitem" ${k === "local" ? "" : `data-stage="${k}"`} data-tip="${esc(t("stage." + k + ".help") + " · " + t(d) + reason(k))}"><i class="dot"></i>${esc(t("stage." + k))}<span class="sr-only"> ${esc(t(d))}</span></button>`).join("")}</div>`;
  }
  const statusWord = (tr) => { const an = tr && tr.analysis; if (!an) return t("status.legacy"); return t({ QUEUED: "status.queued", LOCAL_ANALYSIS: "status.local", ADVANCED_ANALYSIS: "status.advanced", STRUCTURE_ANALYSIS: "status.structure", SONIC_EMBEDDING: "status.embedding", COMPLETE: "status.complete", FAILED: "status.failed" }[an.status] || "status.local"); };

  /* ---- thin monochrome Camelot ring ---- */
  function camelotRing(code, size = 34) {
    const c = size / 2, ro = size / 2 - 3, ri = ro * 0.62; let d = "";
    for (let i = 1; i <= 12; i++) { const a = ((i - 3) / 12) * Math.PI * 2; for (const [letter, r] of [["B", ro], ["A", ri]]) { const on = code === i + letter, x = (c + r * Math.cos(a)).toFixed(1), y = (c + r * Math.sin(a)).toFixed(1); d += on ? `<circle cx="${x}" cy="${y}" r="2.6" fill="#f4f4f2"/>` : `<circle cx="${x}" cy="${y}" r="0.9" fill="#6b6b68"/>`; } }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Camelot ${esc(code || "")}"><circle cx="${c}" cy="${c}" r="${ro}" fill="none" stroke="#3a3a3a" stroke-width=".7"/><circle cx="${c}" cy="${c}" r="${ri}" fill="none" stroke="#3a3a3a" stroke-width=".7"/>${d}</svg>`;
  }
  function sparkline(values, color = "#a3a3a0", h = 38) {
    if (!values || values.length < 2) return `<div class="mono faint" style="height:${h}px">${NA}</div>`;
    const n = values.length, w = 200, mx = Math.max(...values, 1e-9), mn = Math.min(...values, 0);
    const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2" vector-effect="non-scaling-stroke"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}" fill-opacity=".1" stroke="none"/></svg>`;
  }
  const bar = (v, color) => `<div class="bar" role="img" aria-label="${Math.round(v)}%"><i style="width:${Math.max(0, Math.min(100, v))}%;${color ? "background:" + color : ""}"></i></div>`;
  const barTone = (v) => `var(--${v == null ? "text-3" : v >= 80 ? "success" : v >= 55 ? "warning" : "error"})`;

  /* contextual help: a small (?) that shows an explanation from the dictionary */
  const help = (key) => `<button type="button" class="help" data-tip="${esc(t("help." + key))}" aria-label="${esc(t("help.label"))}">?</button>`;
  const seg = (opts, cur, attr) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${String(v) === String(cur) ? "on" : ""}" ${attr}="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
  const sectionHead = (label, right = "") => `<div class="sectionhead"><span class="label">${label}</span><span class="mono dim">${right}</span></div>`;
  const metric = (k, v, s = "", e = "", cls = "") => `<div class="metric ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div>${e ? `<div class="e">${e}</div>` : ""}</div>`;
  const empty = (titleKey, textKey, actionHtml = "") => `<div class="empty"><b>${esc(t(titleKey))}</b>${esc(t(textKey))}${actionHtml ? `<div style="margin-top:12px">${actionHtml}</div>` : ""}</div>`;

  return { keyBadge, keyColor, esc, NA, icon, logo, swirl, mark, art, tone, pct, score, badge, stages, statusWord, camelotRing, sparkline, bar, barTone, help, seg, sectionHead, metric, empty };
})();
