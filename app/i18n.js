/* a.to.b localisation: English / Русский. All user-facing text lives in app/i18n-en.js and app/i18n-ru.js.
 *   t("key", {name: value})   — text with {name} placeholders
 *   tn("key", n, vars)        — plural form: key.one / key.other (EN), key.one / key.few / key.many (RU); {n} is filled in
 * Technical standards (BPM, LUFS, Camelot, WAV, MP3, …) and artist/track names are never translated.
 * First launch: Russian if the browser/system language is Russian, otherwise English. The choice is persisted. */
const I18N_DICT = { en: I18N_EN, ru: I18N_RU };
const LS_LANG = "atob_lang";
function detectLang() {
  try { const s = localStorage.getItem(LS_LANG); if (s === "en" || s === "ru") return s; } catch (e) {}
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return /^ru\b/i.test(nav) ? "ru" : "en";
}
let LANG = detectLang();
function t(key, vars) {
  let s = I18N_DICT[LANG][key];
  if (s == null) s = I18N_DICT.en[key];
  if (s == null) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : "{" + k + "}")) : s;
}
// `tx` is the same function under a name that code with a local variable called `t` (a track) can still reach
const tx = t;
function pluralForm(n, lang = LANG) {
  const a = Math.abs(n);
  if (lang === "ru") { const m10 = a % 10, m100 = a % 100; return m10 === 1 && m100 !== 11 ? "one" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "few" : "many"; }
  return a === 1 ? "one" : "other";
}
function tn(key, n, vars) { return t(key + "." + pluralForm(n), { n, ...(vars || {}) }); }
function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", t(el.dataset.i18nTitle)));
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)));
  document.documentElement.lang = LANG;
  const b = document.getElementById("langBtn"); if (b) b.innerHTML = LANG === "ru" ? "EN / <b>RU</b>" : "<b>EN</b> / RU";
}
// switching language only re-renders text — it never touches audio, analysis results or the library
function setLang(l) {
  if (l !== "en" && l !== "ru") return;
  LANG = l; try { localStorage.setItem(LS_LANG, l); } catch (e) {}
  applyStaticI18n();
  if (typeof renderChrome === "function") renderChrome();
  if (typeof renderActiveView === "function") renderActiveView();
  if (typeof updateTransportUI === "function") updateTransportUI();
  if (typeof renderOnboarding === "function") renderOnboarding();
}
