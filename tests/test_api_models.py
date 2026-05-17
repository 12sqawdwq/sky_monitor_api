from __future__ import annotations

from app.main import SkyChartRequest, SkyFactsRequest


def test_sky_chart_request_accepts_gps_aliases() -> None:
    payload = SkyChartRequest(
        latitude=31.2304,
        longitude=121.4737,
        max_magnitude=3.0,
        total_limit=8,
    )

    assert payload.lat == 31.2304
    assert payload.lon == 121.4737
    assert payload.star_max_mag == 3.0


def test_sky_facts_request_accepts_gps_aliases() -> None:
    payload = SkyFactsRequest(
        latitude=31.2304,
        longitude=121.4737,
        max_magnitude=3.0,
    )

    assert payload.lat == 31.2304
    assert payload.lon == 121.4737
    assert payload.max_mag == 3.0
