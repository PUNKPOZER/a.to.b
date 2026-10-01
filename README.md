# NOESIS

Developed by punk pozer. DJ tools for deeper selection: real audio analysis (BPM, key/Camelot, structure, sonic character), similarity, DJ
compatibility and set building. Runs fully in the browser (static site, GitHub Pages); an optional backend adds deeper analysis.

## Project layout

| Folder | What |
|---|---|
| `index.html`, `ui/noesis.css` | app shell + the NOESIS design system (tokens at the top of the CSS) |
| `ui/` | reusable UI primitives (`primitives.js`) and views: track page, library, set builder, sets/settings |
| `app/` | state & routing, upload/analysis pipeline, backend stages, player & queue, track actions |
| `engine/core.js` | local DSP (legacy BPM/key/genre/profile) — unchanged algorithms |
| `audio/` | pure modules: Essentia.js client/worker, analysis fusion, **DJ engine v2** (similarity, DJ compatibility, set builder), sonic similarity, waveform, ID3 tags |
| `backend/` | FastAPI + Essentia (+ Discogs-EffNet) |
| `structure/` | isolated environment for All-In-One structure analysis |
| `assets/fonts/` | ABC Areal (not in git, see below) |

Logo: `assets/logo.svg` (also the favicon); `ui/logo.js` holds its paths for the inline mark.

## Design system

Tokens (`:root` in `ui/noesis.css`): 4 near-black surface levels, off-white text, 3 grey text levels, hairline borders, a spacing scale,
layout sizes and transition times. **Colour carries information only**: structure (intro blue, verse violet, chorus coral, break/bridge amber,
outro green — the labels are the model's, NOESIS never calls a section "drop") and status (green / amber / coral dots). Everything else is monochrome.
Typography: ABC Areal 400 / 500 / 700 (+ italics), a monospace only for small technical readouts. Icons: one inline SVG family (`UI.icon`).
Components are plain functions returning HTML (`UI.metric`, `UI.trackRow`, `UI.score`, `UI.statusDots`, `UI.camelotRing`, …); the waveform is a canvas (`Waveform.draw`).

**Fonts:** ABC Areal is a commercial typeface, so the `.ttf` files are **git-ignored** (licence for web redistribution unconfirmed). Put the six static
files in `assets/fonts/` locally (see the README there); without them the UI falls back to a neutral system sans-serif.

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
- **NOESIS Sonic Similarity** = 0.55·embedding + 0.15·rhythm + 0.15·timbre + 0.10·energy + 0.05·harmony (веса — `audio/sonic-similarity.js`, конфиг). Причины сходства показываются только если реальный под-скор высок **и** выделяется среди кандидатов.
- **Хранение:** векторы только на бэкенде (`EmbeddingStore`, файлы `.npz` в кэше; интерфейс под FAISS / pgvector). В браузере — компактная метаданная (`analysis.sonic`: модель, версия, размерность, id, топ-стили). **Кэш/устаревание:** ключ = хэш аудио + `model` + `modelVersion`; при смене модели треки помечаются «outdated» (Settings → *Compute missing / outdated*).
- **Где используется:** Similar Tracks (с ▶), Track Details → *Sonic profile* и *Similar in my library*, Next Track (режимы Safe / Balanced / Contrast — не «всегда самое похожее»), Find a Bridge (DJ-совместимость с обоими + положение между A и B в embedding-пространстве).
- **Подготовлено, без UI:** `SimilarityProvider` (`LocalEmbeddingProvider` готов; `ExternalDiscoveryProvider` — заглушка под будущий внешний discovery, ключ только из env на сервере), `POST /api/sonic/journey` (Sonic Journey A→Target).
- **API:** `POST /api/embed`, `POST /api/sonic/{pairwise,similar,bridge,journey,recalibrate}`, `GET /api/sonic/providers`. До 300 треков в матрице; дальше нужен векторный индекс.
- **Статусы:** `LOCAL_ANALYSIS → ADVANCED_ANALYSIS → STRUCTURE_ANALYSIS → SONIC_EMBEDDING → COMPLETE`; все тяжёлые ML-задачи (структура + эмбеддинг) идут через один воркер по очереди.


## Sharing with users (GitHub Pages)

1. Push this repo to GitHub (`main` branch). `.github/workflows/pages.yml` tests, builds and deploys `dist/` on every push.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The app appears at `https://punkpozer.github.io/noesis/`.
3. Users open the link and drop their tracks: local analysis (Essentia.js + legacy DSP), library, similarity, sets, player all run **in their own browser**; audio and library stay on their machine.
4. The advanced backend (Essentia Python, structure, embeddings) is **not** part of Pages. Users who want it run it locally (`./start.command` or `npm run dev`) and set `http://localhost:8000` in Settings; the backend allows `https://punkpozer.github.io` and localhost. For another site origin set `SELECTOR_CORS_ORIGINS`.
5. Before making the repo public check: **ABC Areal** is git-ignored (not deployed; fallback font is used), **essentia.js is AGPL-3.0** and is served from `vendor/`, **Essentia models are CC BY-NC-SA 4.0 (non-commercial)** — see the licence notes above.

## Genre detection

With the backend, the genre comes from the **Discogs-EffNet style activations** (a model trained to classify 400 Discogs music styles, e.g. *Drum n Bass*, *Dubstep*, *Hardcore Hip-Hop*, *House*), averaged over the whole track; the parent genre (Electronic, Hip Hop, …) and the next-best styles are shown, and the activation is the model's own number (not a probability of being "right" — ambiguous tracks stay low, e.g. House 15% next to Breakbeat 14%). The old rule-based guess (tempo/energy windows) is kept in `analysis.genreLegacy` and is the only genre available without a backend (it is approximate and labelled so). A genre you set by hand always wins. Genre similarity between tracks also uses the style activations. On the 8 test tracks the legacy guess said Downtempo / Ambient / Experimental for everything; the model gave Drum n Bass, Dubstep, Hardcore Hip-Hop, Techno and House.
