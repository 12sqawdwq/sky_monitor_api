from __future__ import annotations

import argparse
import csv
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional, Tuple


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV_PATH = PROJECT_ROOT / "data" / "raw" / "hygdata_v3.csv"
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "catalog.db"

SCHEMA_SQL = """
DROP TABLE IF EXISTS stars;

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
"""

INSERT_SQL = """
INSERT INTO stars (
    hyg_id,
    hip,
    hd,
    hr,
    proper_name,
    bayer,
    flamsteed,
    name_en,
    name_zh,
    ra_hours,
    ra_deg,
    dec_deg,
    magnitude,
    distance_pc,
    distance_ly,
    spectral_type,
    color_index,
    constellation,
    source,
    description
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

CHINESE_STAR_NAMES = {
    "achernar": "水委一",
    "acrux": "十字架二",
    "aldebaran": "毕宿五",
    "altair": "牛郎星",
    "antares": "心宿二",
    "arcturus": "大角星",
    "bellatrix": "参宿五",
    "betelgeuse": "参宿四",
    "canopus": "老人星",
    "capella": "五车二",
    "deneb": "天津四",
    "fomalhaut": "北落师门",
    "hadar": "马腹一",
    "pollux": "北河三",
    "polaris": "北极星",
    "procyon": "南河三",
    "regulus": "轩辕十四",
    "rigel": "参宿七",
    "rigil kentaurus": "南门二",
    "sirius": "天狼星",
    "spica": "角宿一",
    "vega": "织女星",
}


@dataclass
class ImportStats:
    raw_rows: int = 0
    imported_rows: int = 0
    skipped_sun: int = 0
    skipped_companion_components: int = 0
    skipped_missing_required: int = 0
    skipped_too_dim: int = 0


def _clean(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip().strip('"')
    return cleaned or None


def _float_or_none(value: Any) -> Optional[float]:
    cleaned = _clean(value)
    if cleaned is None:
        return None
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return parsed


def _int_or_none(value: Any) -> Optional[int]:
    parsed = _float_or_none(value)
    if parsed is None:
        return None
    return int(parsed)


def _name_from_row(row: dict) -> str:
    proper = _clean(row.get("proper"))
    if proper:
        return proper

    bayer = _clean(row.get("bayer"))
    constellation = _clean(row.get("con"))
    if bayer and constellation:
        return f"{bayer} {constellation}"

    flamsteed = _clean(row.get("flam"))
    if flamsteed and constellation:
        return f"{flamsteed} {constellation}"

    hip = _clean(row.get("hip"))
    if hip:
        return f"HIP {hip}"

    hd = _clean(row.get("hd"))
    if hd:
        return f"HD {hd}"

    return f"HYG {_clean(row.get('id')) or 'unknown'}"


def normalize_row(
    row: dict,
    max_magnitude: float,
    include_sun: bool = False,
) -> Optional[Tuple[Any, ...]]:
    proper = _clean(row.get("proper"))
    hyg_id = _int_or_none(row.get("id"))
    if not include_sun and (proper or "").lower() == "sol":
        return None
    if not include_sun and hyg_id == 0:
        return None

    comp_primary = _int_or_none(row.get("comp_primary"))
    if comp_primary is not None and hyg_id is not None and comp_primary not in (0, hyg_id):
        return None

    ra_hours = _float_or_none(row.get("ra"))
    dec_deg = _float_or_none(row.get("dec"))
    magnitude = _float_or_none(row.get("mag"))
    if ra_hours is None or dec_deg is None or magnitude is None:
        return None
    if magnitude > max_magnitude:
        return None
    if not 0.0 <= ra_hours <= 24.0 or not -90.0 <= dec_deg <= 90.0:
        return None

    distance_pc = _float_or_none(row.get("dist"))
    if distance_pc is not None and distance_pc <= 0:
        distance_pc = None
    distance_ly = distance_pc * 3.26156 if distance_pc is not None else None
    name_en = _name_from_row(row)
    name_zh = CHINESE_STAR_NAMES.get(name_en.lower())
    ra_deg = (ra_hours * 15.0) % 360.0

    return (
        hyg_id,
        _int_or_none(row.get("hip")),
        _int_or_none(row.get("hd")),
        _int_or_none(row.get("hr")),
        proper,
        _clean(row.get("bayer")),
        _clean(row.get("flam")),
        name_en,
        name_zh,
        ra_hours,
        ra_deg,
        dec_deg,
        magnitude,
        distance_pc,
        distance_ly,
        _clean(row.get("spect")),
        _float_or_none(row.get("ci")),
        _clean(row.get("con")),
        "HYG",
        "Naked-eye star imported from the HYG catalog.",
    )


def build_database(
    csv_path: Path = DEFAULT_CSV_PATH,
    db_path: Path = DEFAULT_DB_PATH,
    max_magnitude: float = 6.0,
    include_sun: bool = False,
) -> ImportStats:
    if not csv_path.exists():
        raise FileNotFoundError(f"Raw catalog not found: {csv_path}")

    stats = ImportStats()
    rows: List[Tuple[Any, ...]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"id", "ra", "dec", "mag"}
        headers = set(reader.fieldnames or [])
        missing = required - headers
        if missing:
            raise ValueError(f"CSV is missing required HYG columns: {sorted(missing)}")

        for row in reader:
            stats.raw_rows += 1
            magnitude = _float_or_none(row.get("mag"))
            if magnitude is not None and magnitude > max_magnitude:
                stats.skipped_too_dim += 1
                continue

            proper = (_clean(row.get("proper")) or "").lower()
            hyg_id = _int_or_none(row.get("id"))
            if not include_sun and (proper == "sol" or hyg_id == 0):
                stats.skipped_sun += 1
                continue

            comp_primary = _int_or_none(row.get("comp_primary"))
            if comp_primary is not None and hyg_id is not None and comp_primary not in (0, hyg_id):
                stats.skipped_companion_components += 1
                continue

            normalized = normalize_row(row, max_magnitude=max_magnitude, include_sun=include_sun)
            if normalized is None:
                stats.skipped_missing_required += 1
                continue

            rows.append(normalized)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(SCHEMA_SQL)
        connection.executemany(INSERT_SQL, rows)
        connection.commit()

    stats.imported_rows = len(rows)
    return stats


def _brightest_star(db_path: Path) -> Optional[Tuple[str, float]]:
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT name_en, magnitude FROM stars ORDER BY magnitude ASC LIMIT 1"
        ).fetchone()
    if row is None:
        return None
    return str(row[0]), float(row[1])


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the SQLite naked-eye star catalog.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV_PATH)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--max-mag", type=float, default=6.0)
    parser.add_argument("--include-sun", action="store_true")
    args = parser.parse_args()

    stats = build_database(
        csv_path=args.csv,
        db_path=args.db,
        max_magnitude=args.max_mag,
        include_sun=args.include_sun,
    )

    print(f"Raw rows: {stats.raw_rows}")
    print(f"Imported visible stars: {stats.imported_rows}")
    print(f"Skipped Sun/local placeholder rows: {stats.skipped_sun}")
    print(f"Skipped companion component rows: {stats.skipped_companion_components}")
    print(f"Skipped dim stars: {stats.skipped_too_dim}")
    print(f"Skipped invalid required fields: {stats.skipped_missing_required}")
    print(f"Database written to {args.db}")
    brightest = _brightest_star(args.db)
    if brightest is not None:
        print(f"Brightest star: {brightest[0]}, mag={brightest[1]:.2f}")


if __name__ == "__main__":
    main()
