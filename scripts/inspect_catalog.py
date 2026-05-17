from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "catalog.db"


def _connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"Catalog database not found: {db_path}")
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def inspect_database(db_path: Path = DEFAULT_DB_PATH) -> None:
    with _connect(db_path) as connection:
        total = connection.execute("SELECT count(*) AS count FROM stars").fetchone()["count"]
        print(f"Total stars: {total}")

        print("\nTop 20 brightest stars:")
        rows = connection.execute(
            """
            SELECT name_en, name_zh, magnitude, distance_ly, spectral_type, constellation
            FROM stars
            ORDER BY magnitude ASC
            LIMIT 20
            """
        ).fetchall()
        for index, row in enumerate(rows, start=1):
            zh = f" / {row['name_zh']}" if row["name_zh"] else ""
            distance = f"{row['distance_ly']:.2f} ly" if row["distance_ly"] is not None else "unknown distance"
            print(
                f"{index:2d}. {row['name_en']}{zh} | mag={row['magnitude']:.2f} | "
                f"{distance} | {row['spectral_type'] or '-'} | {row['constellation'] or '-'}"
            )

        print("\nMagnitude buckets:")
        buckets = [
            ("<= 0", "magnitude <= 0"),
            ("0 to 1.5", "magnitude > 0 AND magnitude <= 1.5"),
            ("1.5 to 3.5", "magnitude > 1.5 AND magnitude <= 3.5"),
            ("3.5 to 6.0", "magnitude > 3.5 AND magnitude <= 6.0"),
        ]
        for label, predicate in buckets:
            count = connection.execute(f"SELECT count(*) AS count FROM stars WHERE {predicate}").fetchone()[
                "count"
            ]
            print(f"{label:>10}: {count}")

        print("\nKnown star checks:")
        for name in ["Sirius", "Vega", "Betelgeuse", "Polaris"]:
            row = connection.execute(
                """
                SELECT name_en, name_zh, magnitude
                FROM stars
                WHERE lower(name_en) = lower(?)
                   OR lower(proper_name) = lower(?)
                LIMIT 1
                """,
                (name, name),
            ).fetchone()
            if row is None:
                print(f"{name}: missing")
            else:
                zh = f" / {row['name_zh']}" if row["name_zh"] else ""
                print(f"{name}: found as {row['name_en']}{zh}, mag={row['magnitude']:.2f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect the local star catalog database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    args = parser.parse_args()
    inspect_database(args.db)


if __name__ == "__main__":
    main()
