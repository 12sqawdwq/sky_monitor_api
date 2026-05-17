from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Union


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "catalog.db"


PathLike = Union[str, os.PathLike]


def resolve_db_path(db_path: Optional[PathLike] = None) -> Path:
    if db_path is not None:
        return Path(db_path)

    configured = os.getenv("SKY_CATALOG_DB")
    if configured:
        return Path(configured)

    return DEFAULT_DB_PATH


def get_connection(db_path: Optional[PathLike] = None) -> sqlite3.Connection:
    path = resolve_db_path(db_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Catalog database not found at {path}. Run `python scripts/build_catalog_db.py` first."
        )

    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def query_all(
    sql: str,
    params: Iterable[Any] = (),
    db_path: Optional[PathLike] = None,
) -> List[Dict[str, Any]]:
    with get_connection(db_path) as connection:
        rows = connection.execute(sql, tuple(params)).fetchall()
    return [dict(row) for row in rows]


def query_one(
    sql: str,
    params: Iterable[Any] = (),
    db_path: Optional[PathLike] = None,
) -> Optional[Dict[str, Any]]:
    with get_connection(db_path) as connection:
        row = connection.execute(sql, tuple(params)).fetchone()
    return dict(row) if row is not None else None


def database_exists(db_path: Optional[PathLike] = None) -> bool:
    return resolve_db_path(db_path).exists()
