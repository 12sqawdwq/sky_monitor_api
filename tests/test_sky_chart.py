from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.astronomy import build_sky_chart, visible_deep_sky_objects
from app.catalog_query import clear_catalog_cache, get_bright_stars, get_catalog_stats
from app.deep_sky import get_deep_sky_objects
from app.main import SkyChartRequest
from scripts.build_catalog_db import build_database

# Observer at 40°N; every star below sits at dec >= +55, so it is circumpolar (always up).
LAT, LON, WHEN = 40.0, 116.4, "2026-10-21T14:00:00Z"
HEADER = "id,hip,hd,hr,proper,ra,dec,dist,mag,spect,ci,bayer,flam,con\n"


def _star_rows() -> str:
    rows = [
        # A bright star lower in the sky ...
        "1,91262,172167,7001,Vega,18.6156,58.0,7.68,0.03,A0V,0.0,,,Lyr",
        # ... a star with HYG's 100000 pc "unknown distance" placeholder ...
        "2,5000,1,1,Placeholder,3.0,70.0,100000,2.5,K0III,1.0,,,Cas",
    ]
    # ... and thirty dim stars closer to the zenith.
    for k in range(30):
        rows.append(f"{10 + k},{20000 + k},1,1,,{(k * 0.8) % 24:.2f},{80 + (k % 9):.1f},50.0,5.5,G2V,0.6,,,UMi")
    return HEADER + "\n".join(rows) + "\n"


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    csv_path = tmp_path / "hygdata_v3.csv"
    path = tmp_path / "catalog.db"
    csv_path.write_text(_star_rows(), encoding="utf-8")
    build_database(csv_path=csv_path, db_path=path)
    clear_catalog_cache()
    yield path
    clear_catalog_cache()


def _chart(db_path: Path, **kwargs):
    options = dict(lat=LAT, lon=LON, observed_at=WHEN, include_planets=False, include_deep_sky=False, db_path=db_path)
    options.update(kwargs)
    return build_sky_chart(**options)


def test_request_limits_and_defaults() -> None:
    payload = SkyChartRequest(latitude=31.2, longitude=121.5)
    assert payload.total_limit == 100
    assert payload.min_altitude_deg == 0.0
    assert SkyChartRequest(lat=0, lon=0, total_limit=300).total_limit == 300
    with pytest.raises(ValidationError):
        SkyChartRequest(lat=0, lon=0, total_limit=301)


def test_bright_star_is_not_crowded_out_by_dim_high_stars(db_path: Path) -> None:
    chart = _chart(db_path, star_max_mag=6.0, total_limit=8)
    names = [item["name_en"] for item in chart["objects"]]
    assert names[0] == "Vega"
    assert len(chart["objects"]) == 8


def test_star_magnitude_and_altitude_filters_apply(db_path: Path) -> None:
    bright_only = _chart(db_path, star_max_mag=3.0)
    assert {item["name_en"] for item in bright_only["objects"]} == {"Vega", "Placeholder"}
    altitude = {item["name_en"]: item["altitude_deg"] for item in bright_only["objects"]}
    low, high = sorted(altitude.values())
    threshold = (low + high) / 2
    above = _chart(db_path, star_max_mag=3.0, min_altitude_deg=threshold)
    assert [item["altitude_deg"] for item in above["objects"]] == [high]
    assert all(item["altitude_deg"] >= threshold for item in _chart(db_path, star_max_mag=6.0, min_altitude_deg=threshold, total_limit=300)["objects"])


def test_total_limit_is_a_ceiling_not_a_target(db_path: Path) -> None:
    chart = _chart(db_path, star_max_mag=6.0, total_limit=300)
    assert len(chart["objects"]) == 32
    assert chart["constraints"]["total_limit"] == 300


def test_placeholder_distance_is_null(db_path: Path) -> None:
    chart = _chart(db_path, star_max_mag=3.0)
    placeholder = next(item for item in chart["objects"] if item["name_en"] == "Placeholder")
    assert "distance_ly" not in placeholder
    rows = {row["name_en"]: row for row in get_bright_stars(5, db_path=db_path)}
    assert rows["Placeholder"]["distance_ly"] is None
    assert rows["Vega"]["distance_ly"] == pytest.approx(25.05, abs=0.1)
    assert get_catalog_stats(db_path=db_path)["farthest_distance_ly"] < 1000


def test_chart_ids_are_unique(db_path: Path) -> None:
    chart = _chart(db_path, star_max_mag=6.0, total_limit=300, include_deep_sky=True)
    ids = [item["id"] for item in chart["objects"]]
    assert len(ids) == len(set(ids))


def test_category_switches(db_path: Path) -> None:
    without = _chart(db_path, include_deep_sky=False, include_planets=False)
    assert {item["category"] for item in without["objects"]} <= {"star"}
    with_deep = _chart(db_path, include_deep_sky=True, total_limit=300)
    assert any(item["category"] == "deep_sky" for item in with_deep["objects"])


def test_deep_sky_magnitude_filter_has_no_exceptions() -> None:
    objects = visible_deep_sky_objects(lat=LAT, lon=LON, observed_at=WHEN, max_mag=3.0, min_altitude_deg=0.0, limit=None)
    assert objects
    assert all(item["magnitude"] <= 3.0 for item in objects)
    assert "M31" not in {item["id"] for item in objects}  # 3.44 mag, showpiece but still filtered


def test_messier_catalogue_is_complete() -> None:
    catalogue = get_deep_sky_objects()
    ids = [item["id"] for item in catalogue]
    assert len(ids) == len(set(ids))
    assert {f"M{n}" for n in range(1, 111)} <= set(ids)
    for keep in ("Melotte 25", "NGC 869/884", "NGC 5139", "NGC 104", "NGC 3372"):
        assert keep in ids
    for item in catalogue:
        assert 0.0 <= item["ra_deg"] < 360.0
        assert -90.0 <= item["dec_deg"] <= 90.0
        assert -2.0 < item["magnitude"] < 12.0
        assert item["name_en"] and item["name_zh"] and item["object_type"]
