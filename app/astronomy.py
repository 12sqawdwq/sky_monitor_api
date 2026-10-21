from __future__ import annotations

import math
import os
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from app.catalog_query import get_candidate_stars_for_sky, get_duplicate_star_names
from app.deep_sky import get_deep_sky_objects
from app.reasoning_corpus import build_reasoning_context


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ASTROPY_CACHE_DIR = DATA_DIR / ".cache"
ASTROPY_CONFIG_DIR = DATA_DIR / ".config"
SYNODIC_MONTH_DAYS = 29.53058867
KNOWN_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
DateTimeLike = Union[datetime, str]
PathLike = Union[str, Path]
_SKYFIELD_EPHEMERIS = None
_SKYFIELD_TIMESCALE = None


def _prepare_astropy_runtime() -> None:
    (ASTROPY_CACHE_DIR / "astropy").mkdir(parents=True, exist_ok=True)
    (ASTROPY_CONFIG_DIR / "astropy").mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("XDG_CACHE_HOME", str(ASTROPY_CACHE_DIR))
    os.environ.setdefault("XDG_CONFIG_HOME", str(ASTROPY_CONFIG_DIR))

    from astropy.utils import iers

    iers.conf.auto_download = False
    try:
        iers.conf.iers_degraded_accuracy = "silent"
    except Exception:
        pass
    warnings.filterwarnings("ignore", message=".*leap-second file is expired.*")
    warnings.filterwarnings("ignore", message=".*IERS data is valid.*")
    warnings.filterwarnings("ignore", message=".*Cannot convert with full accuracy.*")


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def ensure_utc(value: Optional[DateTimeLike] = None) -> datetime:
    if value is None:
        return utc_now()

    if isinstance(value, str):
        normalized = value.strip()
        if normalized.endswith("Z"):
            normalized = f"{normalized[:-1]}+00:00"
        parsed = datetime.fromisoformat(normalized)
    else:
        parsed = value

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def isoformat_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_location(lat: float, lon: float) -> Tuple[float, float]:
    latitude = float(lat)
    longitude = float(lon)
    if not -90.0 <= latitude <= 90.0:
        raise ValueError("lat must be between -90 and 90 degrees")
    if not -180.0 <= longitude <= 180.0:
        raise ValueError("lon must be between -180 and 180 degrees")
    return latitude, longitude


def calculate_moon_phase(observed_at: Optional[DateTimeLike] = None) -> Dict[str, Any]:
    moment = ensure_utc(observed_at)
    age_days = ((moment - KNOWN_NEW_MOON).total_seconds() / 86400.0) % SYNODIC_MONTH_DAYS
    phase_angle = (age_days / SYNODIC_MONTH_DAYS) * 360.0

    if age_days < 1.84566:
        phase = "New Moon / 新月"
    elif age_days < 5.53699:
        phase = "Waxing Crescent / 娥眉月"
    elif age_days < 9.22831:
        phase = "First Quarter / 上弦月"
    elif age_days < 12.91963:
        phase = "Waxing Gibbous / 盈凸月"
    elif age_days < 16.61096:
        phase = "Full Moon / 满月"
    elif age_days < 20.30228:
        phase = "Waning Gibbous / 亏凸月"
    elif age_days < 23.99361:
        phase = "Last Quarter / 下弦月"
    elif age_days < 27.68493:
        phase = "Waning Crescent / 残月"
    else:
        phase = "New Moon / 新月"

    return {
        "phase": phase,
        "phase_angle": round(phase_angle, 2),
        "age_days": round(age_days, 2),
    }


def _julian_date(moment: datetime) -> float:
    utc = moment.astimezone(timezone.utc)
    return utc.timestamp() / 86400.0 + 2440587.5


def _gmst_deg(moment: datetime) -> float:
    jd = _julian_date(moment)
    centuries = (jd - 2451545.0) / 36525.0
    gmst = (
        280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * centuries * centuries
        - (centuries**3) / 38710000.0
    )
    return gmst % 360.0


def _altaz_fallback(
    ra_deg: float,
    dec_deg: float,
    lat: float,
    lon: float,
    observed_at: datetime,
) -> Tuple[float, float]:
    lat_rad = math.radians(lat)
    dec_rad = math.radians(dec_deg)
    local_sidereal_deg = (_gmst_deg(observed_at) + lon) % 360.0
    hour_angle_deg = ((local_sidereal_deg - ra_deg + 180.0) % 360.0) - 180.0
    hour_angle_rad = math.radians(hour_angle_deg)

    sin_alt = (
        math.sin(dec_rad) * math.sin(lat_rad)
        + math.cos(dec_rad) * math.cos(lat_rad) * math.cos(hour_angle_rad)
    )
    sin_alt = max(-1.0, min(1.0, sin_alt))
    alt_rad = math.asin(sin_alt)

    cos_alt = max(1e-12, math.cos(alt_rad))
    sin_az = -math.sin(hour_angle_rad) * math.cos(dec_rad) / cos_alt
    cos_az = (
        math.sin(dec_rad) - math.sin(alt_rad) * math.sin(lat_rad)
    ) / (cos_alt * max(1e-12, math.cos(lat_rad)))
    az_rad = math.atan2(sin_az, cos_az)

    return math.degrees(az_rad) % 360.0, math.degrees(alt_rad)


def altaz_from_radec(
    ra_deg: float,
    dec_deg: float,
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
) -> Tuple[float, float]:
    moment = ensure_utc(observed_at)

    try:
        _prepare_astropy_runtime()
        from astropy import units as u
        from astropy.coordinates import AltAz, EarthLocation, SkyCoord
        from astropy.time import Time

        location = EarthLocation(lat=lat * u.deg, lon=lon * u.deg)
        coordinate = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
        altaz = coordinate.transform_to(AltAz(obstime=Time(moment), location=location))
        return float(altaz.az.degree) % 360.0, float(altaz.alt.degree)
    except Exception:
        return _altaz_fallback(ra_deg, dec_deg, lat, lon, moment)


def _bulk_altaz_from_stars(
    stars: List[Dict[str, Any]],
    lat: float,
    lon: float,
    observed_at: datetime,
) -> List[Tuple[float, float]]:
    try:
        _prepare_astropy_runtime()
        from astropy import units as u
        from astropy.coordinates import AltAz, EarthLocation, SkyCoord
        from astropy.time import Time

        ra_values = [float(star["ra_deg"]) for star in stars]
        dec_values = [float(star["dec_deg"]) for star in stars]
        location = EarthLocation(lat=lat * u.deg, lon=lon * u.deg)
        coordinates = SkyCoord(ra=ra_values * u.deg, dec=dec_values * u.deg, frame="icrs")
        altaz = coordinates.transform_to(AltAz(obstime=Time(observed_at), location=location))
        return [
            (float(azimuth) % 360.0, float(altitude))
            for azimuth, altitude in zip(altaz.az.degree, altaz.alt.degree)
        ]
    except Exception:
        return [
            _altaz_fallback(
                ra_deg=float(star["ra_deg"]),
                dec_deg=float(star["dec_deg"]),
                lat=lat,
                lon=lon,
                observed_at=observed_at,
            )
            for star in stars
        ]


def observing_method_for_magnitude(magnitude: float) -> str:
    if magnitude <= 1.5:
        return "naked eye, visible even in many cities / 肉眼可见，城市中也较容易看到"
    if magnitude <= 3.5:
        return "naked eye under moderate sky / 普通夜空下肉眼可见"
    if magnitude <= 6.0:
        return "dark sky recommended / 需要较暗天空，城市中可能不可见"
    return "optical aid required / 需要光学辅助"


def _star_display_name(star: Dict[str, Any]) -> str:
    return (
        star.get("name_zh")
        or star.get("proper_name")
        or star.get("name_en")
        or star.get("bayer")
        or star.get("flamsteed")
        or f"HYG {star.get('hyg_id')}"
    )


def _star_name_en(star: Dict[str, Any]) -> str:
    return star.get("name_en") or star.get("proper_name") or _star_display_name(star)


def _star_id(star: Dict[str, Any], duplicated: Dict[str, Any]) -> str:
    """Chart ID of a star: its English name, as before.

    A handful of HYG names are shared by two stars; the brightest keeps the plain name and the
    others get their HIP (or HYG) number appended so IDs stay unique within a response.
    """
    name = _star_name_en(star)
    keeper = duplicated.get(name)
    if keeper is None or keeper == star.get("hyg_id"):
        return name
    if star.get("hip"):
        return f"{name} (HIP {star['hip']})"
    return f"{name} (HYG {star.get('hyg_id')})"


def _visible_star_rows(
    lat: float,
    lon: float,
    moment: datetime,
    max_mag: float,
    min_altitude_deg: float,
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    """Every catalogue star at or brighter than max_mag and at or above min_altitude_deg."""
    candidates = get_candidate_stars_for_sky(max_mag=max_mag, db_path=db_path)
    duplicated = get_duplicate_star_names(db_path=db_path)
    altaz_values = _bulk_altaz_from_stars(candidates, lat, lon, moment) if candidates else []
    visible: List[Dict[str, Any]] = []

    for star, (azimuth, altitude) in zip(candidates, altaz_values):
        magnitude = float(star["magnitude"])
        if altitude < min_altitude_deg or magnitude > max_mag:
            continue

        visible.append(
            {
                "id": _star_id(star, duplicated),
                "name_en": _star_name_en(star),
                "name_zh": star.get("name_zh"),
                "ra_deg": round(float(star["ra_deg"]), 6),
                "dec_deg": round(float(star["dec_deg"]), 6),
                "azimuth_deg": round(azimuth, 2),
                "altitude_deg": round(altitude, 2),
                "magnitude": round(magnitude, 2),
                "distance_ly": round(float(star["distance_ly"]), 2)
                if star.get("distance_ly") is not None
                else None,
                "spectral_type": star.get("spectral_type"),
                "constellation": star.get("constellation"),
                "observing_method": observing_method_for_magnitude(magnitude),
            }
        )

    # Brightness first; altitude only breaks ties.
    visible.sort(key=lambda item: (item["magnitude"], -item["altitude_deg"]))
    return visible


def visible_stars(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
    max_mag: float = 6.0,
    min_altitude_deg: float = 10.0,
    limit: int = 10,
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    latitude, longitude = validate_location(lat, lon)
    moment = ensure_utc(observed_at)
    visible = _visible_star_rows(latitude, longitude, moment, max_mag, min_altitude_deg, db_path)
    for item in visible:
        item.pop("id", None)
    return visible[: max(1, min(int(limit), 20))]


def visible_deep_sky_objects(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
    max_mag: float = 9.0,
    min_altitude_deg: float = 15.0,
    limit: Optional[int] = 12,
) -> List[Dict[str, Any]]:
    """Catalogue deep-sky objects at or brighter than max_mag and at or above min_altitude_deg.

    `limit=None` returns every match.
    """
    latitude, longitude = validate_location(lat, lon)
    moment = ensure_utc(observed_at)
    candidates = get_deep_sky_objects()
    altaz_values = _bulk_altaz_from_stars(candidates, latitude, longitude, moment)
    visible: List[Dict[str, Any]] = []

    for item, (azimuth, altitude) in zip(candidates, altaz_values):
        magnitude = float(item["magnitude"])
        if altitude < min_altitude_deg or magnitude > max_mag:
            continue

        visible.append(
            {
                "id": item["id"],
                "name_en": item["name_en"],
                "name_zh": item.get("name_zh"),
                "object_type": item["object_type"],
                "ra_deg": round(float(item["ra_deg"]), 6),
                "dec_deg": round(float(item["dec_deg"]), 6),
                "azimuth_deg": round(azimuth, 2),
                "altitude_deg": round(altitude, 2),
                "magnitude": round(magnitude, 2),
                "constellation": item.get("constellation"),
                "importance": item.get("importance", 3),
            }
        )

    visible.sort(key=lambda item: (item["importance"], item["magnitude"], -item["altitude_deg"]))
    return visible if limit is None else visible[: max(1, int(limit))]


# Ephemeris key, chart label (also the object's ID), category, object_type.
SOLAR_SYSTEM_BODIES: List[Tuple[str, str, str, str]] = [
    ("sun", "Sun / 太阳", "sun", "sun"),
    ("moon", "Moon / 月亮", "moon", "moon"),
    ("mercury", "Mercury / 水星", "planet", "planet"),
    ("venus", "Venus / 金星", "planet", "planet"),
    ("mars", "Mars / 火星", "planet", "planet"),
    ("jupiter barycenter", "Jupiter / 木星", "planet", "planet"),
    ("saturn barycenter", "Saturn / 土星", "planet", "planet"),
    ("uranus barycenter", "Uranus / 天王星", "planet", "planet"),
    ("neptune barycenter", "Neptune / 海王星", "planet", "planet"),
]
SUN_MAGNITUDE = -26.74


def _load_skyfield() -> Optional[Tuple[Any, Any]]:
    global _SKYFIELD_EPHEMERIS, _SKYFIELD_TIMESCALE
    ephemeris_path = DATA_DIR / "de421.bsp"
    if not ephemeris_path.exists():
        return None
    from skyfield.api import load, load_file

    if _SKYFIELD_TIMESCALE is None:
        _SKYFIELD_TIMESCALE = load.timescale()
    if _SKYFIELD_EPHEMERIS is None:
        _SKYFIELD_EPHEMERIS = load_file(str(ephemeris_path))
    return _SKYFIELD_EPHEMERIS, _SKYFIELD_TIMESCALE


def _moon_magnitude(phase_angle_deg: float) -> float:
    # Allen's approximation for the full-disc visual magnitude of the Moon.
    angle = abs(phase_angle_deg)
    return -12.73 + 0.026 * angle + 4.0e-9 * angle**4


def solar_system_positions(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
) -> List[Dict[str, Any]]:
    """Sun, Moon and the seven planets as seen from (lat, lon) at observed_at, via DE421.

    Altitude and azimuth are apparent (aberration and light time included); ra_deg / dec_deg are
    astrometric ICRS, like the catalogue stars.
    """
    try:
        loaded = _load_skyfield()
        if loaded is None:
            return []
        from skyfield.api import wgs84
        from skyfield.magnitudelib import planetary_magnitude

        ephemeris, timescale = loaded
        moment = ensure_utc(observed_at)
        skyfield_time = timescale.from_datetime(moment)
        earth = ephemeris["earth"]
        observer = (earth + wgs84.latlon(latitude_degrees=lat, longitude_degrees=lon)).at(skyfield_time)
        geocentre = earth.at(skyfield_time)
        sun = ephemeris["sun"]
        results = []
        for key, label, category, object_type in SOLAR_SYSTEM_BODIES:
            body = ephemeris[key]
            astrometric = observer.observe(body)
            apparent = astrometric.apparent()
            altitude, azimuth, distance = apparent.altaz()
            ra, dec, _ = astrometric.radec()
            if key == "sun":
                magnitude: Optional[float] = SUN_MAGNITUDE
            elif key == "moon":
                magnitude = _moon_magnitude(float(apparent.phase_angle(sun).degrees))
            else:
                try:
                    magnitude = float(planetary_magnitude(geocentre.observe(body)))
                except Exception:
                    magnitude = None
                if magnitude is not None and not math.isfinite(magnitude):
                    magnitude = None
            results.append(
                {
                    "name": label,
                    "category": category,
                    "object_type": object_type,
                    "ra_deg": round(float(ra._degrees) % 360.0, 6),
                    "dec_deg": round(float(dec.degrees), 6),
                    "azimuth_deg": round(float(azimuth.degrees), 2),
                    "altitude_deg": round(float(altitude.degrees), 2),
                    "distance_au": round(float(distance.au), 6 if key == "moon" else 4),
                    "magnitude": round(magnitude, 2) if magnitude is not None else None,
                }
            )
        return results
    except Exception:
        return []


def planet_positions(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
) -> List[Dict[str, Any]]:
    """Planets only, in the original /sky/facts shape."""
    return [
        {
            "name": body["name"],
            "azimuth_deg": body["azimuth_deg"],
            "altitude_deg": body["altitude_deg"],
            "distance_au": body["distance_au"],
        }
        for body in solar_system_positions(lat, lon, observed_at)
        if body["category"] == "planet"
    ]


def _chart_position(azimuth_deg: float, altitude_deg: float) -> Dict[str, float]:
    azimuth_rad = math.radians(azimuth_deg)
    radius = max(0.0, min(1.0, (90.0 - altitude_deg) / 90.0))
    return {
        "x": round(math.sin(azimuth_rad) * radius, 4),
        "y": round(math.cos(azimuth_rad) * radius, 4),
        "radius": round(radius, 4),
        "zenith_distance_deg": round(max(0.0, 90.0 - altitude_deg), 2),
    }


# label_priority: lower is shown first. Brightness dominates; altitude adds at most 0.5.
def _altitude_term(item: Dict[str, Any]) -> float:
    return (90.0 - float(item.get("altitude_deg", 0.0))) / 180.0


def _star_label_priority(star: Dict[str, Any]) -> float:
    return round(float(star.get("magnitude", 6.0)) + _altitude_term(star), 4)


def _deep_sky_label_priority(item: Dict[str, Any]) -> float:
    # Extended objects look fainter than a star of the same magnitude, so they sit after the
    # bright stars; showpieces (importance 1) still rank among the 2nd-3rd magnitude stars.
    importance = float(item.get("importance", 3))
    magnitude = float(item.get("magnitude", 9.0))
    return round(1.0 + importance + magnitude / 3.0 + _altitude_term(item), 4)


def _solar_system_label_priority(item: Dict[str, Any]) -> float:
    if item.get("category") == "sun":
        return round(-30.0 + _altitude_term(item), 4)
    if item.get("category") == "moon":
        return round(-20.0 + _altitude_term(item), 4)
    magnitude = item.get("magnitude")
    return round((float(magnitude) if magnitude is not None else 6.0) + _altitude_term(item), 4)


def _format_threshold(value: float) -> str:
    return f"{float(value):g}"


def _as_chart_object(
    item: Dict[str, Any],
    category: str,
    label_priority: float,
    selection_reason: str,
) -> Dict[str, Any]:
    azimuth = float(item["azimuth_deg"])
    altitude = float(item["altitude_deg"])
    position = _chart_position(azimuth, altitude)
    object_id = str(item.get("id") or item.get("name_en") or item.get("name") or category)
    name_en = item.get("name_en") or item.get("name") or object_id
    name_zh = item.get("name_zh")

    chart_object = {
        "id": object_id,
        "category": category,
        "object_type": item.get("object_type", category),
        "name_en": name_en,
        "name_zh": name_zh,
        "display_name": name_zh or name_en,
        "ra_deg": item.get("ra_deg"),
        "dec_deg": item.get("dec_deg"),
        "azimuth_deg": round(azimuth, 2),
        "altitude_deg": round(altitude, 2),
        "magnitude": item.get("magnitude"),
        "constellation": item.get("constellation"),
        "chart_x": position["x"],
        "chart_y": position["y"],
        "chart_radius": position["radius"],
        "zenith_distance_deg": position["zenith_distance_deg"],
        "label_priority": label_priority,
        "selection_reason": selection_reason,
    }
    for optional_key in ("distance_ly", "distance_au", "spectral_type"):
        if item.get(optional_key) is not None:
            chart_object[optional_key] = item[optional_key]
    return chart_object


CHART_LIMIT_MIN = 8
CHART_LIMIT_MAX = 300
CHART_LIMIT_DEFAULT = 100


def build_sky_chart(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
    star_max_mag: float = 3.0,
    deep_sky_max_mag: float = 9.0,
    min_altitude_deg: float = 0.0,
    total_limit: int = CHART_LIMIT_DEFAULT,
    include_planets: bool = True,
    include_deep_sky: bool = True,
    db_path: Optional[PathLike] = None,
) -> Dict[str, Any]:
    latitude, longitude = validate_location(lat, lon)
    moment = ensure_utc(observed_at)
    limit = max(CHART_LIMIT_MIN, min(int(total_limit), CHART_LIMIT_MAX))
    min_alt = float(min_altitude_deg)
    alt_text = _format_threshold(min_alt)

    # 1. Filter every category by its own thresholds; no per-category quotas.
    chart_objects: List[Dict[str, Any]] = []
    star_reason = f"bright_star_mag_lte_{_format_threshold(star_max_mag)}_alt_gte_{alt_text}"
    for star in _visible_star_rows(latitude, longitude, moment, star_max_mag, min_alt, db_path):
        chart_objects.append(
            _as_chart_object(star, category="star", label_priority=_star_label_priority(star), selection_reason=star_reason)
        )

    if include_deep_sky:
        deep_sky_reason = f"deep_sky_mag_lte_{_format_threshold(deep_sky_max_mag)}_alt_gte_{alt_text}"
        for item in visible_deep_sky_objects(
            lat=latitude,
            lon=longitude,
            observed_at=moment,
            max_mag=deep_sky_max_mag,
            min_altitude_deg=min_alt,
            limit=None,
        ):
            chart_objects.append(
                _as_chart_object(
                    item, category="deep_sky", label_priority=_deep_sky_label_priority(item), selection_reason=deep_sky_reason
                )
            )

    if include_planets:
        solar_reason = f"solar_system_alt_gte_{alt_text}"
        for body in solar_system_positions(latitude, longitude, moment):
            if float(body["altitude_deg"]) < min_alt:
                continue
            chart_objects.append(
                _as_chart_object(
                    body,
                    category=body["category"],
                    label_priority=_solar_system_label_priority(body),
                    selection_reason=solar_reason,
                )
            )

    # 2. Rank everything together, 3. then cut to the requested total.
    chart_objects.sort(key=lambda item: (item["label_priority"], -item["altitude_deg"], item["display_name"]))
    chart_objects = chart_objects[:limit]

    counts: Dict[str, int] = {}
    for item in chart_objects:
        counts[item["category"]] = counts.get(item["category"], 0) + 1

    chart = {
        "observer": {
            "lat": latitude,
            "lon": longitude,
        },
        "time_utc": isoformat_z(moment),
        "coordinate_system": {
            "horizontal": "azimuth_deg: 0 north, 90 east, 180 south, 270 west; altitude_deg: horizon 0, zenith 90",
            "chart_projection": "polar_azimuthal_horizon",
            "chart_orientation": "north_up_east_right",
            "chart_units": "normalized radius; horizon edge is 1.0, zenith is 0.0",
        },
        "constraints": {
            "star_max_magnitude": star_max_mag,
            "deep_sky_max_magnitude": deep_sky_max_mag,
            "min_altitude_deg_for_stars_and_deep_sky": min_alt,
            "planet_min_altitude_deg": min_alt,
            "total_limit": limit,
        },
        "counts": counts,
        "objects": chart_objects,
    }
    chart["reasoning_context"] = build_reasoning_context(chart)
    return chart


def build_answer_facts(
    lat: float,
    lon: float,
    observed_at: Optional[DateTimeLike] = None,
    max_mag: float = 3.0,
    star_limit: int = 10,
    min_altitude_deg: float = 15.0,
    include_planets: bool = True,
    db_path: Optional[PathLike] = None,
) -> Dict[str, Any]:
    latitude, longitude = validate_location(lat, lon)
    moment = ensure_utc(observed_at)
    return {
        "location": {
            "lat": latitude,
            "lon": longitude,
        },
        "time_utc": isoformat_z(moment),
        "moon_phase": calculate_moon_phase(moment),
        "visible_stars": visible_stars(
            lat=latitude,
            lon=longitude,
            observed_at=moment,
            max_mag=max_mag,
            min_altitude_deg=min_altitude_deg,
            limit=star_limit,
            db_path=db_path,
        ),
        "visible_planets": planet_positions(latitude, longitude, moment) if include_planets else [],
    }


def build_spoken_answer(answer_facts: Dict[str, Any]) -> str:
    stars = answer_facts.get("visible_stars", [])
    moon = answer_facts.get("moon_phase", {})
    if not stars:
        return f"现在月相是{moon.get('phase', '未知')}。当前条件下没有筛选到高度超过十度的肉眼可见亮星。"

    selected = stars[:5]
    star_phrases = []
    for star in selected:
        name = star.get("name_zh") or star.get("name_en")
        altitude = star.get("altitude_deg")
        azimuth = star.get("azimuth_deg")
        magnitude = star.get("magnitude")
        star_phrases.append(f"{name}，高度约{altitude}度，方位角约{azimuth}度，视星等{magnitude}")

    return f"现在月相是{moon.get('phase', '未知')}。你能看到的较明显恒星包括：" + "；".join(star_phrases) + "。"
