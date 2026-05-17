from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from app.db import query_all, query_one, resolve_db_path


PathLike = Union[str, Path]


STAR_COLUMNS = """
    id,
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
"""


_CANDIDATE_CACHE: Dict[Tuple[str, int, int, float], List[Dict[str, Any]]] = {}


def _bounded_limit(limit: int, default: int, maximum: int) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, maximum))


def get_bright_stars(
    limit: int = 100,
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    safe_limit = _bounded_limit(limit, default=100, maximum=1000)
    return query_all(
        f"""
        SELECT {STAR_COLUMNS}
        FROM stars
        ORDER BY magnitude ASC, name_en ASC
        LIMIT ?
        """,
        (safe_limit,),
        db_path=db_path,
    )


def get_stars_by_magnitude(
    max_mag: float = 6.0,
    limit: int = 5000,
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    safe_limit = _bounded_limit(limit, default=5000, maximum=20000)
    return query_all(
        f"""
        SELECT {STAR_COLUMNS}
        FROM stars
        WHERE magnitude <= ?
        ORDER BY magnitude ASC, name_en ASC
        LIMIT ?
        """,
        (float(max_mag), safe_limit),
        db_path=db_path,
    )


def get_star_by_name(
    name: str,
    db_path: Optional[PathLike] = None,
) -> Optional[Dict[str, Any]]:
    cleaned = " ".join(name.strip().split())
    if not cleaned:
        return None

    exact = query_one(
        f"""
        SELECT {STAR_COLUMNS}
        FROM stars
        WHERE lower(proper_name) = lower(?)
           OR lower(name_en) = lower(?)
           OR lower(name_zh) = lower(?)
           OR lower(bayer) = lower(?)
           OR lower(flamsteed) = lower(?)
        LIMIT 1
        """,
        (cleaned, cleaned, cleaned, cleaned, cleaned),
        db_path=db_path,
    )
    if exact is not None:
        return exact

    pattern = f"%{cleaned}%"
    return query_one(
        f"""
        SELECT {STAR_COLUMNS}
        FROM stars
        WHERE lower(proper_name) LIKE lower(?)
           OR lower(name_en) LIKE lower(?)
           OR lower(name_zh) LIKE lower(?)
        ORDER BY magnitude ASC
        LIMIT 1
        """,
        (pattern, pattern, pattern),
        db_path=db_path,
    )


def get_candidate_stars_for_sky(
    max_mag: float = 6.0,
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    path = resolve_db_path(db_path)
    stat = path.stat()
    safe_mag = float(max_mag)
    cache_key = (str(path.resolve()), stat.st_mtime_ns, stat.st_size, safe_mag)
    cached = _CANDIDATE_CACHE.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached]

    rows = get_stars_by_magnitude(max_mag=safe_mag, limit=20000, db_path=path)
    _CANDIDATE_CACHE.clear()
    _CANDIDATE_CACHE[cache_key] = [dict(row) for row in rows]
    return rows


def clear_catalog_cache() -> None:
    _CANDIDATE_CACHE.clear()


def get_catalog_stats(db_path: Optional[PathLike] = None) -> Dict[str, Any]:
    path = resolve_db_path(db_path)
    stats = query_one(
        """
        SELECT
            count(*) AS total_stars,
            min(magnitude) AS brightest_magnitude,
            max(magnitude) AS dimmest_magnitude,
            min(distance_ly) AS nearest_distance_ly,
            max(distance_ly) AS farthest_distance_ly
        FROM stars
        """,
        db_path=path,
    )
    if stats is None:
        stats = {
            "total_stars": 0,
            "brightest_magnitude": None,
            "dimmest_magnitude": None,
            "nearest_distance_ly": None,
            "farthest_distance_ly": None,
        }
    stats["database_path"] = str(path)
    stats["source"] = "HYG"
    stats["magnitude_filter"] = "<= 6.0"
    return stats
