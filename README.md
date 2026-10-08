# a.to.b

DJ selection, set building and transition planning, by punk pozer. Real audio analysis (BPM, key/Camelot, structure, sonic character), similarity,
DJ compatibility, a Set Builder with a Transition Guide, and exports for Rekordbox / M3U8 / TXT. Runs fully in the browser (static site, GitHub Pages);
an optional backend adds deeper analysis. Interface in **Русский / English** (Russian by default on a Russian system, switchable any time without re-analysis).

> Formerly a.to.b. Existing libraries and sets keep loading (same storage keys); the desktop app keeps its `a.to.b` data folder so an installed engine survives.

## What it does

| Area | |
|---|---|
| **Analyze** | Import files or a whole folder (drag anywhere on the window). Four independent stages — **Local** (browser), **Essentia**, **Structure**, **Embedding** (backend); each can be run on its own and none requires another. Waveform with structure sections (Mono / Spectral), metrics, similar tracks with mini waveforms. |
| **Scores** | *Sonic similarity* (how alike two tracks sound) and *DJ compatibility* (how well they mix) are always separate. Every score shows its factors and a confidence level (HIGH / MEDIUM / LOW). Factors without data are **left out and the weights re-normalised** — never guessed. |
| **Set Builder** | 30 / 45 / 60 / 90 / 120 min, energy curves (incl. custom, draggable), crate, track roles (suggested or yours), drag & drop with a handle (mouse, touch, or ↑/↓ on the keyboard), locks, Auto / Manual mode with an explicit **Optimize**, *Find alternative* (scored against **both** neighbours), *What to play next* (Safe, Groove match, Energy up/down, Genre switch, Surprise), *Find a bridge*, an explainable **Set score**. Only the transitions that changed are recalculated. |
| **Transition Guide** | Best mix-out / mix-in point (time, bar, phrase, section), overlap in bars, transition type, difficulty, confidence, with two aligned waveforms; drag a marker to set your own point (snaps to the bar grid, stored with the set, used by the exports). |
| **Export** | Rekordbox XML (collection + playlist + optional memory cues / beat grid), M3U8, TXT tracklist, Transition Sheet (TXT / JSON); validated before export; the dialog includes the Rekordbox import steps. |

## Honesty rules

- Nothing is invented. Missing data is shown as «—» / "unavailable" with the reason.
- The bar grid used for mix points is either **analyzed** (All-In-One downbeats) or **estimated** (constant tempo from BPM + first beat); estimated grids are labelled everywhere and never exported as a beat grid.
- Section labels come from the model and can be wrong; they are shown as returned.
- Manual values (BPM, key, genre, mix points) always win over automatic ones.
- The Rekordbox XML follows AlphaTheta's published *XML file format for playlists sharing* (v1.0.0). It never touches Rekordbox's own database. It has been checked against that specification and our parser tests, not inside Rekordbox itself.

## Score audit (what changed)

The old feature scores mapped every cosine with `(cos+1)/2`, which puts any two non-negative feature vectors between 50 and 100 and made some groups
(drums, bass: one-dimensional) constantly 100. Now (`audio/dj-engine.js`, `audio/calibration.js`, `tools/calibrate-groups.mjs`):

- vector groups are scored as the **percentile of a random pair** measured on a reference library (45 tracks, 990 pairs); uninformative groups (all pairs identical) are dropped;
- scalar features (drum / bass / melodic density, danceability, brightness, …) use the calibrated distribution of differences;
- an unknown key is **not** scored as a neutral 50 — the factor is left out and the confidence drops;
- the energy-curve shape no longer has a built-in 50 % baseline.

## Install as an app / PWA

`manifest.webmanifest` + the icons in `assets/icons/` make the site installable from the browser. The desktop app (below) is the full-engine version.

## Project layout

| Folder | What |
|---|---|
| `index.html`, `ui/atob.css` | app shell + design system (tokens at the top of the CSS) |
| `ui/` | views (`analyze`, `library`, `setbuilder`, `transition-guide`, `export-dialog`, `sets-settings`, `onboarding`) and `primitives.js` |
| `app/` | state & routing, i18n (`i18n.js`, `i18n-en.js`, `i18n-ru.js`), import pipeline, backend stages, player, track actions |
| `audio/` | pure, unit-tested modules: `dj-engine` (similarity, DJ compatibility, set builder), `calibration`, `grid`, `transition`, `set-tools`, `export`, plus Essentia client/worker, fusion, sonic similarity, waveform, ID3 |
| `engine/core.js` | local DSP (BPM/key/genre/profile) |
| `backend/` | FastAPI + Essentia (+ Discogs-EffNet) |
| `structure/` | isolated environment for All-In-One structure analysis |
| `assets/brand/`, `assets/icons/` | logo (colour / white / black), symbol, app icon, favicons, PWA icons |
| `tools/` | calibration, icon generation, i18n key scan |
| `test/` | `npm test` (62 tests: engine, grid, transitions, set tools, export, i18n key coverage) |

## Privacy

Analysis runs in your browser. Audio is sent only to the backend URL **you** configure (local by default). No API key is ever in the page; any future
external provider would live on the server only. Library and sets stay in this browser (localStorage; audio files in IndexedDB).

## Versions

App `0.5.1`, analysis version `6`. Stored tracks keep the version they were analysed with (Settings shows how many are older); nothing is silently re-analysed.
Embeddings record model + version; outdated ones are flagged and recomputed on request.

## Limitations

Transition points need a bar grid (backend structure analysis, or a BPM + first beat from Essentia); local-only tracks get a compatibility score but no mix point.
Windows runs the portable engine (no Essentia); structure analysis needs Apple Silicon (All-In-One MLX).

## Similarity v2, DJ Compatibility v2, Set Builder

All in `audio/dj-engine.js` (pure, unit-tested). **Similarity** = tempo · rhythm · timbre · harmony · energy · structure · genre (weights in `DjEngine.SIM_WEIGHTS`,
editable in Settings); with embeddings the **Sonic similarity** adds the calibrated Discogs-EffNet score. **DJ compatibility** = tempo (pitch-range aware, half/double-time ok) ·
Camelot · rhythm · groove · energy progression · structure (outro of A vs. intro of B) · genre; factors without data are left out and the rest renormalised, and every
transition explains itself from the measured values. The two scores are always shown separately.
**Set builder** (`DjEngine.buildSet`): beam search over the library for 30 / 45 / 60 / 90 minutes (mix overlaps counted), balancing DJ compatibility, fit to the editable energy
curve, sonic character (Safe / Balanced / Contrast), variety and a seeded touch of surprise — not "sort by BPM then Camelot". Next-track and bridge suggestions use the same factors.

## Local analysis: Essentia.js (Phase 1)

Анализ в браузере = legacy DSP (автокорреляция + peak-interval) **+ Essentia.js 0.1.3**
(WASM, в Web Worker, UI не блокируется). Если Essentia не загрузилась (офлайн,
`file://`, старый браузер) — приложение молча остаётся на legacy-анализе.

- **BPM** — консенсус до 3 источников (`essentia.js`, `legacy-autocorrelation`,
  `legacy-peak-interval`) с нормализацией half/double/2:3/3:4 (`audio/analysis-fusion.js`).
  `reliability` — собственная мера согласия методов; «model confidence» Essentia
  (RhythmExtractor2013, шкала 0–5.3) показывается отдельно.
- **Key / Camelot** — Essentia `KeyExtractor` (профили bgate + edma), сверка с legacy
  Krumhansl-Schmuckler; Camelot считается детерминированно по таблице из (key, scale).
- Также: danceability, onset rate, регулярность битов (Essentia), в localStorage —
  только компактные скаляры.
- Ручные правки (`manualOverrides`) имеют приоритет над любым анализом.

### Запуск

```bash
npm install          # ставит essentia.js (pinned 0.1.3)
npm run vendor       # копирует runtime essentia.js в vendor/essentia/ (уже закоммичено)
npm start            # http://localhost:8080  (dev-сервер без зависимостей)
npm test             # тесты слоя фьюжна
npm run build        # собирает dist/ — статика для GitHub Pages
```

Деплой: GitHub Pages может отдавать корень репозитория или `dist/` — это чистая статика,
сборщика нет.

> **Лицензия:** essentia.js распространяется под **AGPL-3.0**; сам проект — MIT.
> Вместе с ним публикуется `vendor/essentia/` (с файлом LICENSE). Для публичного
> распространения проверьте совместимость лицензий.

## Advanced Analysis backend (Phase 2): FastAPI + Essentia

Необязательный сервер для более точного анализа **всего трека** (а не первых 90 с). Без него
приложение работает как раньше (статус «Advanced Analysis unavailable», `LOCAL ONLY` в шапке).

- **BPM:** три независимых оценщика Essentia (RhythmExtractor2013, BeatTrackerDegara, PercivalBpmEstimator)
  + подгонка сетки битов → точность до сотых; `alternatives` показывает half/double-time.
- **Key:** 6 профилей (bgate, edma, edmm, shaath, temperley, krumhansl) по всему треку и по 40-секундным
  сегментам, голосование с весами; reliability = доля голосов за победивший Camelot.
- Также: LUFS (EBU R128), dynamic complexity, MFCC / spectral contrast / centroid / rolloff / flux, danceability, onset rate.
- Приоритет: **ручная правка > backend > локальный анализ**. Бэкенд никогда не перезаписывает ручные значения.
- Аудио не хранится на сервере (temp-файл удаляется), результаты кешируются по SHA-256 (`GET /api/analysis/{id}`).

```bash
# Python 3.12 нужен: у Essentia нет колёс для 3.14. Также нужен ffmpeg.
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt   # или python3.12 -m venv + pip
.venv/bin/uvicorn app.main:app --port 8000      # http://localhost:8000/api/health
.venv/bin/python -m pytest -q tests             # тесты на синтетике с известным BPM/тональностью
# Docker:
docker build -t selector-api backend && docker run -p 8000:8000 selector-api
```

Фронтенд находит бэкенд так: URL из Settings → Advanced Analysis backend (`localStorage`), либо
`config.js` (см. `config.example.js`), либо `http://localhost:8000`, если страница открыта с localhost.
Продакшен-URL в код не зашит. CORS: localhost и `https://punkpozer.github.io`; дополнительные origin —
`SELECTOR_CORS_ORIGINS` (см. `backend/.env.example`). Для хостинга: ~1 CPU-ядро и 1–2 ГБ RAM на трек
(декод стерео float32 ≈ 150 МБ на 7 мин), диск — только кэш JSON, Python 3.12, ffmpeg.

## Плеер и waveform

Оригинальные файлы сохраняются в IndexedDB браузера — треки можно прослушивать (▶ в Library, Track Detail,
нижний плеер, клик по waveform = перемотка) и после перезагрузки. Waveform трёхполосный: красный — бас,
зелёный — середина, синий — верха (хранится компактно, ~2.5 КБ на трек). Старые треки без аудио не играют.

## Быстрый старт для разработки

```bash
npm run setup   # npm install + vendor essentia.js + backend venv (Python 3.12 + Essentia); нужны Node>=18 и ffmpeg
npm run dev     # фронтенд http://localhost:8080 + бэкенд http://localhost:8000
```

> Деплой/копирование: `index.html` нельзя выкладывать один — рядом должны лежать `audio/` и `vendor/`.
> Если модули не найдены, приложение продолжит анализ на legacy DSP (без waveform/плеера/Essentia) и
> напишет предупреждение в консоль.

**Самый простой запуск на macOS:** двойной клик по `start.command` — при первом запуске сам поставит
недостающее (Node, зависимости, бэкенд) и откроет http://localhost:8080.

## Phase 3: структура трека (All-In-One)

**Реализация:** [`all-in-one-mlx`](https://github.com/ssmall256/all-in-one-mlx) 1.0.14 — порт оригинального
[All-In-One](https://github.com/mir-aidj/all-in-one) (те же веса модели `harmonix-all`) на Apple MLX. Оригинал не ставится на
современный macOS (нужны `natten` под CUDA и `madmom`, не собирающийся на Python ≥3.10). Работает в **отдельном
окружении** `structure/.venv` (Python 3.12), которое API вызывает подпроцессом — PyTorch/MLX не конфликтует с Essentia
(`numpy<2`). Только Apple Silicon; на Linux/Docker нужна отдельная реализация (оригинальный allin1 + CUDA/CPU) — пока не сделано.
Первый запуск скачивает веса htdemucs (~160 МБ конверсия) и модели All-In-One. Один трек ~30 с.

Что реально возвращает модель: BPM, beats, **downbeats**, границы секций, метки (`intro/verse/chorus/break/bridge/inst/solo/outro`),
embeddings (сохраняются **только на бэкенде** через `EmbeddingStore`, см. `backend/app/embeddings.py` — интерфейс под
pgvector/FAISS). DJ-признаки (`backend/app/structure.py`): firstDownbeat, bar, introBars/outroBars (только если модель
поставила такую метку), границы секций, majorTransitions (скачок громкости ≥3 дБ), breakdownPositions (метка break/bridge и
секция тише на ≥2 дБ). Метка «drop» не используется. Метки модели могут ошибаться — уверенность модель не отдаёт.

API: `POST /api/structure`, `GET /api/structure/{id}`, `GET /api/embeddings/nearest/{id}`; `/api/health` показывает `structure.available`.
Статусы трека: `LOCAL_ANALYSIS → ADVANCED_ANALYSIS → STRUCTURE_ANALYSIS → COMPLETE | FAILED`; `analysis.version` = 4 после структуры.
Tempo All-In-One — ещё один голос в BPM-консенсусе.

## Плеер: секции, превью, горячие клавиши
Waveform с цветной полосой секций (intro/verse/chorus/break…) и чипами — клик по секции перематывает. В Similar Tracks у каждого
трека есть ▶ (превью стартует с первой секции после интро) и мини-waveform. Пробел — play/pause.

## Sonic Similarity (Discogs-EffNet embeddings)

Отдельный слой «насколько треки звучат одинаково». Не заменяет Essentia / All-In-One и **не равен DJ Compatibility** — оба показателя считаются независимо и показываются рядом (например Sonic 91% / DJ 72%).

- **Модель:** `discogs-effnet-bs64-1` (Essentia Models, «EffnetDiscogs», Alonso-Jiménez et al., ISMIR 2022), с `essentia.upf.edu/models/…`, sha256 проверяется при загрузке (~18 МБ, скачивается один раз в `backend/models/`). **Лицензия модели — CC BY-NC-SA 4.0 (некоммерческая; коммерческая лицензия — по запросу у MTG/UPF).**
- **Runtime:** `essentia-tensorflow` (официальный алгоритм `TensorflowPredictEffnetDiscogs`), CPU. Этот пакет заменяет `essentia` в окружении бэкенда (не ставить оба).
- **Эмбеддинг:** 1280-d на кадр (~1 с), размерность читается из модели. **Агрегация трека:** mean pooling по кадрам; покадровые векторы (float16) тоже хранятся на бэкенде для будущих section-level embeddings (`sonic.section_embedding`).
- **Сходство:** cosine между mean-векторами → **калибровка** в UI-процент (`sonic_calibration.json`): % = перцентиль сырого cosine среди типичных пар треков, т.е. «91% = похожи сильнее, чем 91% случайных пар». Сырой cosine хранится/показывается отдельно (tooltip). Шкала откалибрована на 40 треках (780 пар) из локальных папок разработчика; `Settings → Recalibrate %` пересчитывает её по вашей библиотеке (≥15 треков).
- **a.to.b Sonic Similarity** = 0.55·embedding + 0.15·rhythm + 0.15·timbre + 0.10·energy + 0.05·harmony (веса — `audio/sonic-similarity.js`, конфиг). Причины сходства показываются только если реальный под-скор высок **и** выделяется среди кандидатов.
- **Хранение:** векторы только на бэкенде (`EmbeddingStore`, файлы `.npz` в кэше; интерфейс под FAISS / pgvector). В браузере — компактная метаданная (`analysis.sonic`: модель, версия, размерность, id, топ-стили). **Кэш/устаревание:** ключ = хэш аудио + `model` + `modelVersion`; при смене модели треки помечаются «outdated» (Settings → *Compute missing / outdated*).
- **Где используется:** Similar Tracks (с ▶), Track Details → *Sonic profile* и *Similar in my library*, Next Track (режимы Safe / Balanced / Contrast — не «всегда самое похожее»), Find a Bridge (DJ-совместимость с обоими + положение между A и B в embedding-пространстве).
- **Подготовлено, без UI:** `SimilarityProvider` (`LocalEmbeddingProvider` готов; `ExternalDiscoveryProvider` — заглушка под будущий внешний discovery, ключ только из env на сервере), `POST /api/sonic/journey` (Sonic Journey A→Target).
- **API:** `POST /api/embed`, `POST /api/sonic/{pairwise,similar,bridge,journey,recalibrate}`, `GET /api/sonic/providers`. До 300 треков в матрице; дальше нужен векторный индекс.
- **Статусы:** `LOCAL_ANALYSIS → ADVANCED_ANALYSIS → STRUCTURE_ANALYSIS → SONIC_EMBEDDING → COMPLETE`; все тяжёлые ML-задачи (структура + эмбеддинг) идут через один воркер по очереди.


## Sharing with users (GitHub Pages)

1. Push this repo to GitHub (`main` branch). `.github/workflows/pages.yml` tests, builds and deploys `dist/` on every push.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The app appears at `https://punkpozer.github.io/a.to.b/`.
3. Users open the link and drop their tracks: local analysis (Essentia.js + legacy DSP), library, similarity, sets, player all run **in their own browser**; audio and library stay on their machine.
4. The advanced backend (Essentia Python, structure, embeddings) is **not** part of Pages. Users who want it run it locally (`./start.command` or `npm run dev`) and set `http://localhost:8000` in Settings; the backend allows `https://punkpozer.github.io` and localhost. For another site origin set `SELECTOR_CORS_ORIGINS`.
5. Before making the repo public check: **ABC Areal** is git-ignored (not deployed; fallback font is used), **essentia.js is AGPL-3.0** and is served from `vendor/`, **Essentia models are CC BY-NC-SA 4.0 (non-commercial)** — see the licence notes above.

## Genre detection

With the backend, the genre comes from the **Discogs-EffNet style activations** (a model trained to classify 400 Discogs music styles, e.g. *Drum n Bass*, *Dubstep*, *Hardcore Hip-Hop*, *House*), averaged over the whole track; the parent genre (Electronic, Hip Hop, …) and the next-best styles are shown, and the activation is the model's own number (not a probability of being "right" — ambiguous tracks stay low, e.g. House 15% next to Breakbeat 14%). The old rule-based guess (tempo/energy windows) is kept in `analysis.genreLegacy` and is the only genre available without a backend (it is approximate and labelled so). A genre you set by hand always wins. Genre similarity between tracks also uses the style activations. On the 8 test tracks the legacy guess said Downtempo / Ambient / Experimental for everything; the model gave Drum n Bass, Dubstep, Hardcore Hip-Hop, Techno and House.

Ranking detail (`audio/genre-rank.js`): the displayed genre is the model's top style, except that *Halftime* (a rhythmic feel, not a filing genre) is demoted ×0.75 so e.g. Halftime 0.45 / Drum n Bass 0.40 reads as Drum n Bass. A tempo-window prior was tested on 56 tracks from a real DJ library and dropped: it changed no result and would hurt wherever the measured BPM is off by an octave or 3:2 ratio. Genres seen on that library include Techno, House, Dubstep, Bassline, Electro, Drum n Bass, Hardstyle, Schranz, Psy-Trance, Trance, Breaks, Big Beat, Nu-Disco, Grime, Trap and Hardcore Hip-Hop.

## Desktop app (macOS / Windows)

Download from **[Releases](https://github.com/PUNKPOZER/a.to.b/releases)**: `a.to.b-<version>-arm64.dmg` (Apple Silicon Mac) or `a.to.b Setup <version>.exe` (Windows). Open the .dmg and drag a.to.b to Applications.

**Mac (Apple Silicon): the full version out of the box.** On the first launch a.to.b sets up its own analysis engine (progress screen, ~1.7 GB, a few minutes, internet needed once): Python 3.12 via the bundled `uv`, Essentia + TensorFlow, the All-In-One structure analyzer and the Discogs-EffNet model; ffmpeg is bundled. The engine lives in `~/Library/Application Support/a.to.b/engine` and starts and stops with the app (FastAPI on `127.0.0.1:8000`). Every later launch opens straight away. Help → *Repair advanced analysis…* reinstalls it. Everything runs locally; the music never leaves the computer.
**Windows: the portable engine.** Essentia publishes no Windows build, so on Windows the engine runs *without* Essentia: on first launch a.to.b installs Python + ONNX Runtime and runs the **Discogs-EffNet model through the official ONNX export** (a numpy re-implementation of Essentia's mel front-end, verified against Essentia: embedding cosine 1.000000, activations within 1e-5). You get the same genres (400 Discogs styles), sonic similarity, "similar in my library", bridges and next-track modes as on the Mac. Not available on Windows: the whole-track Essentia analysis (BPM/key come from the in-browser Essentia.js on the first 90 s instead) and structure analysis (sections / downbeats; All-In-One needs Apple Silicon). The Windows build was compiled on GitHub but could not be run on a real Windows machine by the author — please report problems.
Intel Macs are not built (the structure analyzer needs Apple Silicon).

Unsigned builds: macOS says "cannot be opened because the developer cannot be verified" — right-click the app → **Open** once (or System Settings → Privacy & Security → Open Anyway); Windows SmartScreen says "Windows protected your PC" — **More info → Run anyway**. Removing the warnings needs an Apple Developer ID / a Windows code-signing certificate.
The ABC Areal fonts are bundled only in builds made where `assets/fonts/*.ttf` exist (CI releases use the fallback font) — mind the font licence before distributing such builds.

```bash
npm install && npm run vendor
npm run desktop            # open the app window from a checkout (uses backend/.venv if it is set up)
npm run dist:mac           # -> release/a.to.b-<version>-arm64.dmg
npm run dist:win           # -> release/a.to.b Setup <version>.exe (build on Windows, or via the workflow)
git tag v0.3.1 && git push --tags   # the "Desktop installers" workflow builds both and attaches them to a Release
```
Developer mode: running from a checkout that has `backend/.venv` uses that backend instead of installing the engine. `npm run icon` regenerates `build/icon.png` from `assets/logo.svg`.

### Portable engine (any OS)
`backend/requirements-portable.txt` + `SELECTOR_PORTABLE=1` run the API without Essentia (health reports `analysis.available: false`; `/api/analyze` returns 503; the app skips that stage and continues with sonic / genre). `app/sonic.py` picks the runtime automatically: `essentia-tensorflow` when installed, otherwise `onnxruntime` (`discogs-effnet-bsdynamic-1.onnx`, sha256-pinned, downloaded once). The ONNX path is also much faster (about 1 s for a 4-minute track on an M-series CPU vs ~7 s through TensorFlow).

### Model download (desktop first launch)
The desktop app downloads the Discogs-EffNet files itself, through Chromium's network stack (system certificates and proxy), verifies the SHA-256 from `backend/app/model_files.json` and tries two sources in order: the MTG server (`essentia.upf.edu`) and a GitHub mirror (release `models-v1`, unmodified files, CC BY-NC-SA 4.0). This fixed a Windows failure where Python's own HTTPS client rejected the MTG server's certificate chain ("unable to get local issuer certificate").
