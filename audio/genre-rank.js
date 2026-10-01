/* Picks the displayed genre from Discogs style activations.
 * "Halftime" describes a rhythmic feel (it co-occurs with Drum n Bass, Dubstep, Trap…) rather than a genre a DJ
 * would file a track under, so it is demoted (x0.75) when ranking: a track at Halftime 0.45 / Drum n Bass 0.40 is
 * shown as Drum n Bass with Halftime listed next to it. Everything else is left exactly as the model ranks it.
 * (A tempo-window prior was tried and dropped: on 56 tracks it changed nothing useful and it hurts whenever the
 * measured BPM is itself off by an octave or a 3:2 ratio.) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GenreRank = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DESCRIPTORS = { Halftime: 0.75 };
  const name = (label) => label.split("---").pop();
  function rerank(styles) {
    const out = styles.map((s, i) => ({ ...s, rank: i, adjusted: s.score * (DESCRIPTORS[name(s.label)] ?? 1) }));
    return out.sort((a, b) => b.adjusted - a.adjusted);
  }
  return { DESCRIPTORS, rerank, name };
});
