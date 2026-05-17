# Rokid Sky Assistant Database Plan

## 0. Goal / 目标

Build a local astronomy catalog backend for the Rokid AI Glasses voice Q&A assistant.

The first database version should focus on naked-eye visible stars, meaning stars with apparent magnitude `<= 6.0`. This keeps the database small, fast, explainable, and suitable for real-time voice interaction.

The backend should not ask the LLM to calculate astronomy positions. The database stores stable facts; the astronomy engine calculates time-dependent visibility; the LLM only turns structured facts into natural spoken answers.

```text
Catalog DB / 星表数据库
    ↓
Astronomy Engine / 天文计算层
    ↓
Structured Facts / 结构化事实
    ↓
LLM Verbalization / 大模型生成朗读回答
    ↓
Rokid AI Glasses / AI 眼镜问答
```

## 1. Recommended First Data Source / 第一阶段推荐数据源

Use HYG Database first, not full Gaia DR3.

Reason:

- HYG is easier to import and practical for MVP.
- It contains common star names, RA, Dec, magnitude, distance, spectral type, and constellation-like identifiers.
- Filtering `mag <= 6.0` gives a small naked-eye star catalog.
- Gaia DR3 is much larger and better suited for later advanced query layers.

Gaia DR3 can be added later as a remote or offline extension. Gaia DR3 contains around 1.812 billion sources with positions and brightnesses, so it is not appropriate as the first real-time local database layer.

## 2. Database Choice / 数据库选择

Use SQLite for V0 and V1.

SQLite is enough because the `mag <= 6.0` catalog is small. It is local, simple, portable, and easy to bundle with the backend. SQLite also supports R-Tree indexing for range queries, which can be useful later for RA/Dec bounding-box filtering.

Use PostgreSQL + pgSphere only after the project needs advanced cone search, multi-user cloud deployment, or very large catalogs.

## 3. Directory Structure / 项目结构

Codex should create or update the project like this:

```text
rokid-sky-assistant/
  app/
    main.py
    astronomy.py
    db.py
    catalog_query.py
  data/
    raw/
      hygdata_v3.csv
    catalog.db
  scripts/
    download_hyg.py
    build_catalog_db.py
    inspect_catalog.py
  tests/
    test_catalog.py
  requirements.txt
  plan.md
```

## 4. Dependencies / 依赖

Update `requirements.txt`:

```txt
fastapi
uvicorn
pydantic
skyfield
astropy
pandas
requests
```

Optional later:

```txt
astroquery
sqlalchemy
```

For now, use Python standard `sqlite3` instead of SQLAlchemy. This keeps the first version transparent and easy to debug.

## 5. Database Schema / 数据库结构

Create SQLite database at:

```text
data/catalog.db
```

Create table:

```sql
CREATE TABLE IF NOT EXISTS stars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hyg_id INTEGER,
    hip INTEGER,
    hd INTEGER,
    hr INTEGER,
    proper_name TEXT,
    bayer TEXT,
    flamsteed TEXT,
    name_en TEXT,
    name_zh TEXT,
    ra_hours REAL NOT NULL,
    ra_deg REAL NOT NULL,
    dec_deg REAL NOT NULL,
    magnitude REAL NOT NULL,
    distance_pc REAL,
    distance_ly REAL,
    spectral_type TEXT,
    color_index REAL,
    constellation TEXT,
    source TEXT DEFAULT 'HYG',
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_stars_mag ON stars(magnitude);
CREATE INDEX IF NOT EXISTS idx_stars_ra_dec ON stars(ra_deg, dec_deg);
CREATE INDEX IF NOT EXISTS idx_stars_name ON stars(proper_name);
```

Important field meanings:

- `ra_hours`: right ascension in hours / 赤经，单位小时。
- `ra_deg`: right ascension converted to degrees / 赤经角度。
- `dec_deg`: declination in degrees / 赤纬角度。
- `magnitude`: apparent visual magnitude / 视星等，数值越小越亮。
- `distance_pc`: parsec / 秒差距。
- `distance_ly`: light years / 光年。
- `spectral_type`: stellar spectral type / 恒星光谱型。

## 6. Import Rule / 数据导入规则

Only import stars where:

```sql
magnitude <= 6.0
```

Also ignore records without valid RA/Dec or magnitude.

Conversion rules:

```python
ra_deg = ra_hours * 15.0
```

```python
distance_ly = distance_pc * 3.26156
```

If `distance_pc` is missing or invalid, store `NULL`.

## 7. Script 1: Download HYG / 下载星表

Create:

```text
scripts/download_hyg.py
```

Responsibilities:

- Download HYG CSV if a stable public URL is configured.
- Otherwise print clear manual instructions.
- Save raw CSV to `data/raw/hygdata_v3.csv`.
- Do not overwrite existing file unless `--force` is passed.

Expected command:

```bash
python scripts/download_hyg.py
```

If Codex cannot confirm a stable download URL, implement this script as a safe placeholder with manual instructions.

## 8. Script 2: Build SQLite DB / 构建数据库

Create:

```text
scripts/build_catalog_db.py
```

Responsibilities:

- Read `data/raw/hygdata_v3.csv`.
- Filter stars with `mag <= 6.0`.
- Normalize fields.
- Convert RA from hours to degrees.
- Convert parsecs to light years.
- Create `data/catalog.db`.
- Insert rows into `stars`.
- Print import statistics.

Expected command:

```bash
python scripts/build_catalog_db.py
```

Expected output example:

```text
Raw rows: 119617
Imported visible stars: 5064
Database written to data/catalog.db
Brightest star: Sirius, mag=-1.44
```

## 9. Script 3: Inspect DB / 检查数据库

Create:

```text
scripts/inspect_catalog.py
```

Responsibilities:

- Print total star count.
- Print top 20 brightest stars.
- Print count grouped by magnitude range.
- Check if `Sirius`, `Vega`, `Betelgeuse`, `Polaris` exist.

Expected command:

```bash
python scripts/inspect_catalog.py
```

## 10. Backend DB Module / 后端数据库模块

Create:

```text
app/db.py
```

Responsibilities:

- Open SQLite connection.
- Use row factory to return dict-like rows.
- Provide reusable query helper.

Suggested functions:

```python
get_connection()
query_all(sql: str, params: tuple = ())
query_one(sql: str, params: tuple = ())
```

## 11. Catalog Query Module / 星表查询模块

Create:

```text
app/catalog_query.py
```

Suggested functions:

```python
get_bright_stars(limit: int = 100)
get_stars_by_magnitude(max_mag: float = 6.0, limit: int = 5000)
get_star_by_name(name: str)
get_candidate_stars_for_sky(max_mag: float = 6.0)
```

V0 query can simply load all `mag <= 6.0` stars into memory and let Astropy calculate current altitude/azimuth.

This is acceptable because the catalog is small.

## 12. Astronomy Integration / 天文计算集成

Update:

```text
app/astronomy.py
```

Current responsibilities should become:

- Calculate moon phase.
- Calculate planet positions with Skyfield.
- Load candidate stars from SQLite.
- Convert each star RA/Dec to current AltAz using Astropy.
- Filter visible stars:

```python
altitude_deg > 10
magnitude <= 6.0
```

- Sort by:

```text
1. altitude higher first
2. magnitude brighter first
```

Return top 5 to 10 visible stars for voice answer.

## 13. API Contract / API 返回格式

Update `/sky/ask` to return structured data:

```json
{
  "answer_facts": {
    "location": {
      "lat": 35.6812,
      "lon": 139.7671
    },
    "time_utc": "2026-05-15T12:00:00Z",
    "moon_phase": {
      "phase": "Waxing Crescent / 娥眉月",
      "phase_angle": 45.2
    },
    "visible_stars": [
      {
        "name_en": "Sirius",
        "name_zh": "天狼星",
        "ra_deg": 101.287,
        "dec_deg": -16.716,
        "azimuth_deg": 225.4,
        "altitude_deg": 28.1,
        "magnitude": -1.46,
        "distance_ly": 8.6,
        "spectral_type": "A1V",
        "observing_method": "naked eye / 肉眼可见"
      }
    ]
  },
  "spoken_answer": "..."
}
```

The backend may generate a basic `spoken_answer`, but the frontend LLM can rewrite it.

Important rule for the LLM prompt:

```text
Use only the facts in answer_facts. Do not invent distances, magnitudes, names, telescope apertures, or visibility.
```

## 14. Observing Method Rule / 观测方式规则

For stars:

```python
if magnitude <= 1.5:
    observing_method = "naked eye, visible even in many cities / 肉眼可见，城市中也较容易看到"
elif magnitude <= 3.5:
    observing_method = "naked eye under moderate sky / 普通夜空下肉眼可见"
elif magnitude <= 6.0:
    observing_method = "dark sky recommended / 需要较暗天空，城市中可能不可见"
else:
    observing_method = "optical aid required / 需要光学辅助"
```

Do not recommend telescope aperture for ordinary stars unless there is a specific reason. For deep-sky objects, aperture advice can be added later.

## 15. Tests / 测试

Create:

```text
tests/test_catalog.py
```

Minimum tests:

- Database file exists after build.
- `stars` table contains rows.
- All imported stars have `magnitude <= 6.0`.
- RA degrees are between `0` and `360`.
- Dec degrees are between `-90` and `90`.
- `get_bright_stars(10)` returns 10 or fewer rows sorted by magnitude.

Run:

```bash
pytest
```

If pytest is not installed, add it to dev dependencies.

## 16. Codex Task Order / Codex 执行顺序

Ask Codex to execute in this order:

1. Create `data/raw`, `scripts`, and missing app modules.
2. Update `requirements.txt`.
3. Implement `scripts/download_hyg.py`.
4. Implement `scripts/build_catalog_db.py`.
5. Implement `scripts/inspect_catalog.py`.
6. Implement `app/db.py`.
7. Implement `app/catalog_query.py`.
8. Update `app/astronomy.py` to use catalog stars.
9. Update `/sky/ask` response format.
10. Add tests.
11. Run import script.
12. Run inspect script.
13. Run API locally.
14. Test with `/docs`.

## 17. Manual Test / 手动验收

Start API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open:

```text
http://127.0.0.1:8000/docs
```

POST:

```json
{
  "lat": 35.6812,
  "lon": 139.7671,
  "question": "我现在头顶有什么星星？"
}
```

Acceptance criteria:

- API returns HTTP 200.
- Response includes `moon_phase`.
- Response includes `visible_stars`.
- Every visible star has altitude, azimuth, magnitude, and distance if available.
- No returned star has `magnitude > 6.0`.
- Spoken answer is short enough for voice output.

## 18. Future Extension / 后续扩展

V1:

- Add Chinese star names for top 200 bright stars.
- Add constellation names in Chinese and English.
- Add Messier catalog.
- Add NGC subset for common deep-sky objects.

V2:

- Add SQLite R-Tree or bounding-box prefiltering.
- Add light pollution mode: city / suburb / dark sky.
- Add weather API for cloud cover and visibility.

V3:

- Add Gaia Archive query with `astroquery.gaia` for advanced questions.
- Add PostgreSQL + pgSphere if cone search becomes central.
- Add cache by location and time window.

## 19. Non-goals / 暂不做

Do not implement these in the first version:

- Full Gaia DR3 local import.
- Trillion-object database.
- AR sky overlay.
- Real-time rendering.
- Telescope control.
- Complex calendar or astrology features.

This project is an astronomy assistant, not an astrology assistant.

## 20. Definition of Done / 完成标准

The database phase is done when:

- `data/catalog.db` exists.
- It contains only stars with `magnitude <= 6.0`.
- The API can calculate which of those stars are currently visible for a given latitude and longitude.
- The API returns structured facts suitable for an LLM to verbalize.
- The system can answer: “我现在头顶有什么星星？” with real altitude, azimuth, magnitude, and distance data.

