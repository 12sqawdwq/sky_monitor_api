from __future__ import annotations

import sqlite3
from pathlib import Path

from app.catalog_query import get_bright_stars
from scripts.build_catalog_db import build_database


SAMPLE_CSV = """id,hip,hd,hr,proper,ra,dec,dist,mag,spect,ci,bayer,flam,con
0,,,,Sol,0,0,0,-26.7,G2V,0.656,,,
1,32349,48915,2491,Sirius,6.752477,-16.716116,2.6371,-1.46,A1V,-0.03,,,CMa
2,91262,172167,7001,Vega,18.615649,38.783689,7.6787,0.03,A0V,0.0,,,Lyr
3,27989,39801,2061,Betelgeuse,5.919529,7.407064,197.0,0.5,M1I,1.85,,,Ori
4,11767,8890,424,Polaris,2.530301,89.264109,132.0,1.98,F7Ib,0.6,,,UMi
5,99999,1,1,,1.0,1.0,100.0,7.2,G2V,0.6,,,Ori
6,99998,1,1,,1.0,,100.0,4.2,G2V,0.6,,,Ori
"""


def _build_sample_db(tmp_path: Path) -> Path:
    csv_path = tmp_path / "hygdata_v3.csv"
    db_path = tmp_path / "catalog.db"
    csv_path.write_text(SAMPLE_CSV, encoding="utf-8")
    build_database(csv_path=csv_path, db_path=db_path)
    return db_path


def test_database_file_exists_after_build(tmp_path: Path) -> None:
    db_path = _build_sample_db(tmp_path)
    assert db_path.exists()


def test_stars_table_contains_rows(tmp_path: Path) -> None:
    db_path = _build_sample_db(tmp_path)
    with sqlite3.connect(db_path) as connection:
        count = connection.execute("SELECT count(*) FROM stars").fetchone()[0]
    assert count == 4


def test_all_imported_stars_have_magnitude_at_or_below_six(tmp_path: Path) -> None:
    db_path = _build_sample_db(tmp_path)
    with sqlite3.connect(db_path) as connection:
        count = connection.execute("SELECT count(*) FROM stars WHERE magnitude > 6.0").fetchone()[0]
    assert count == 0


def test_imported_coordinates_are_in_valid_ranges(tmp_path: Path) -> None:
    db_path = _build_sample_db(tmp_path)
    with sqlite3.connect(db_path) as connection:
        invalid_ra = connection.execute(
            "SELECT count(*) FROM stars WHERE ra_deg < 0 OR ra_deg >= 360"
        ).fetchone()[0]
        invalid_dec = connection.execute(
            "SELECT count(*) FROM stars WHERE dec_deg < -90 OR dec_deg > 90"
        ).fetchone()[0]
    assert invalid_ra == 0
    assert invalid_dec == 0


def test_get_bright_stars_returns_limited_sorted_rows(tmp_path: Path) -> None:
    db_path = _build_sample_db(tmp_path)
    rows = get_bright_stars(10, db_path=db_path)
    magnitudes = [row["magnitude"] for row in rows]
    assert len(rows) <= 10
    assert magnitudes == sorted(magnitudes)
    assert rows[0]["name_en"] == "Sirius"
