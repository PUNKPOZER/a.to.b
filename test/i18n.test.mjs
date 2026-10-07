import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import vm from "node:vm";
import { keys as literalKeys } from "../tools/i18n-keys.mjs";

const load = (f, name) => vm.runInNewContext(fs.readFileSync(f, "utf8") + `;${name}`);
const EN = load("app/i18n-en.js", "I18N_EN"), RU = load("app/i18n-ru.js", "I18N_RU");
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

// families the code builds at run time: prefix + each suffix
const FAMILIES = {
  "col.": ["track", "bpm", "key", "genre", "energy", "sonic", "dj", "status"], "conf.": ["high", "medium", "low", "full", "missing"], "curve.": ["smooth", "buildup", "peak", "wave", "journey", "experimental", "custom"],
  "dfac.": ["tempoFar", "tempoStretch", "keyFar", "keyStep", "rhythmMismatch", "shortOverlap", "energyJump", "lowConfidence", "none"], "diff.": ["easy", "medium", "hard", "experimental"],
  "dj.": ["tempo", "key", "rhythm", "groove", "energy", "structure", "genre"], "exp.guide.": ["1", "2", "3", "4", "5"], "exp.issue.": ["noFilename", "noLocation", "noDuration", "duplicate", "unsupportedFormat"],
  "exp.f.": ["rekordbox", "m3u8", "txt", "sheet", "sheetjson"], "gconf.": ["gridEstimatedA", "gridEstimatedB", "noSections", "tempoFar", "bpmUncertain", "ok"], "grid.": ["analyzed", "estimated"], "guide.reason.": ["noGrid", "gridTooShort"],
  "help.": ["similar", "structure", "grid", "bpm", "camelot", "dj", "compare", "curve", "mode", "character", "duration", "setscore", "crate", "next", "guide", "expcues", "expgrid", "expbase", "label"],
  "mixout.": ["outro-start", "phrase-boundary", "last-bars"], "next.": ["safe", "groove", "energyUp", "energyDown", "genreSwitch", "surprise", "safe.tip", "groove.tip", "energyUp.tip", "energyDown.tip", "genreSwitch.tip", "surprise.tip"],
  "note.": ["tempoOk", "tempoFar", "tempoOctave", "keySame", "keyRelative", "keyAdjacent", "keyFar", "keyUnknown", "energyUp", "energyDown", "structureOk", "structureNone", "rhythm", "groove"],
  "onb.welcome.": ["title", "text", "text2"], "onb.import.": ["title", "text", "text2"], "onb.analysis.": ["title", "text", "text2"], "onb.similar.": ["title", "text", "text2"], "onb.setbuilder.": ["title", "text", "text2"], "onb.guide.": ["title", "text", "text2"], "onb.export.": ["title", "text", "text2"],
  "player.repeat.": ["off", "all", "one"], "preset.": ["balanced", "rhythm", "sound", "harmony", "harmonic", "tempo", "energy"], "role.": ["auto", "opener", "warmup", "builder", "peak", "release", "closer"],
  "score.comp.": ["transitions", "energy", "tempo", "harmony", "variety", "coherence"], "score.": ["sonic", "dj", "sonicShort", "djShort", "simShort"],
  "section.": ["intro", "verse", "chorus", "inst", "break", "bridge", "outro", "solo", "start", "end"], "setscore.": ["smoothTempo", "goodHarmony", "coherent", "allTransitionsSolid", "weakTransition", "harmonicConflict", "tempoJump", "flatEnergy", "title", "needTwo"],
  "sim.": ["embedding", "rhythm", "timbre", "energy", "harmony", "tempo", "genre", "structure", "basisSonic", "basisFeature", "partial"],
  "stage.": ["title", "local", "essentia", "structure", "embedding", "local.help", "essentia.help", "structure.help", "embedding.help", "localDone", "localNone", "essentiaDone", "essentiaUnavailable", "structureDone", "structureUnavailable", "embeddingDone", "embeddingUnavailable", "error", "running", "notRun"],
  "status.": ["queued", "local", "advanced", "structure", "embedding", "complete", "failed", "legacy", "localOnly", "online", "offline", "openSettings"], "step.": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  "tab.": ["overview", "structure", "spectral", "rhythm", "harmonic", "similar", "dj", "notes"], "ttype.": ["quick_cut", "breakdown", "drop_swap", "long_blend", "bass_swap", "energy_reset", "echo_out", "short_blend"],
  "twhy.": ["tempoFar", "keyClash", "outInBreak", "chorusAfterIntro", "longOverlapRoom", "bothBassHeavy", "bigEnergyAndGenreMove", "noOutro", "overlapBars"], "why.sim.": ["embedding", "timbre", "rhythm", "energy", "harmony"],
  "spectral.": ["brightness", "darkness", "texture", "bassDensity", "drumDensity", "acousticness", "electronicness"], "key.": ["major", "minor"], "unit.": ["min", "h", "bars"], "onb.": ["v.analysis", "v.export", "next", "done"],
  "player.": ["pause"], "harm.": ["melodic"], "similar.": ["noMatch"], "lib.": ["emptyTitle", "emptyText", "statusAll", "statusComplete", "statusStructure", "statusSonic", "statusNoAudio"],
  "sb.": ["lock", "unlock", "lockTip", "lockFirst", "unlockFirst", "lockLast", "unlockLast", "roleAuto", "roleManual"], "sets.": ["emptyTitle", "emptyText"],
};
const PLURAL = ["toast.crateAdded"];

test("both languages define exactly the same keys, with the same placeholders", () => {
  assert.deepEqual(Object.keys(EN).sort().filter((k) => !/\.(few|many)$/.test(k) && !/\.(one|other)$/.test(k)), Object.keys(RU).sort().filter((k) => !/\.(few|many)$/.test(k) && !/\.(one|other)$/.test(k)));
  for (const k of Object.keys(EN)) { if (/\.(one|other)$/.test(k)) continue; assert.ok(k in RU, "missing in RU: " + k); assert.equal(ph(EN[k]), ph(RU[k]), "placeholders differ: " + k); }
  for (const [k, v] of Object.entries({ ...EN, ...RU })) assert.ok(String(v).trim().length, "empty: " + k);
});
test("every key referenced in the source exists in both languages", () => {
  const miss = [];
  for (const k of literalKeys) { if (k.endsWith(".") || PLURAL.includes(k)) continue; if (!(k in EN)) miss.push("EN " + k); if (!(k in RU)) miss.push("RU " + k); }
  for (const [p, sfx] of Object.entries(FAMILIES)) for (const s of sfx) { const k = p + s; if (!(k in EN)) miss.push("EN " + k); if (!(k in RU)) miss.push("RU " + k); }
  assert.deepEqual(miss, []);
});
test("plural forms exist: EN one/other, RU one/few/many", () => {
  for (const k of PLURAL) { assert.ok(EN[k + ".one"] && EN[k + ".other"], k); assert.ok(RU[k + ".one"] && RU[k + ".few"] && RU[k + ".many"], k); }
});
test("no key is left unused-by-typo: every EN key is referenced literally, by a family, or is a plural form", () => {
  const fam = new Set(Object.entries(FAMILIES).flatMap(([p, s]) => s.map((x) => p + x)));
  const dead = Object.keys(EN).filter((k) => !literalKeys.has(k) && !fam.has(k) && !/\.(one|other)$/.test(k));
  assert.deepEqual(dead, []);
});
