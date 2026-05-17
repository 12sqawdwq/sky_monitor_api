from __future__ import annotations

import argparse
import csv
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterable, TextIO


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "site" / "wiki" / "cities.tsv"
DEFAULT_URL = "https://download.geonames.org/export/dump/cities1000.zip"


def _iter_geonames_rows(handle: TextIO) -> Iterable[dict[str, str]]:
    fieldnames = [
        "geonameid",
        "name",
        "asciiname",
        "alternatenames",
        "latitude",
        "longitude",
        "feature_class",
        "feature_code",
        "country_code",
        "cc2",
        "admin1_code",
        "admin2_code",
        "admin3_code",
        "admin4_code",
        "population",
        "elevation",
        "dem",
        "timezone",
        "modification_date",
    ]
    reader = csv.DictReader(handle, delimiter="\t", fieldnames=fieldnames)
    yield from reader


def _write_city_index(source: Path, output: Path) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    rows_written = 0
    with source.open("r", encoding="utf-8", newline="") as input_handle:
        with output.open("w", encoding="utf-8", newline="") as output_handle:
            writer = csv.writer(output_handle, delimiter="\t", lineterminator="\n")
            writer.writerow(["name", "ascii", "aliases", "lat", "lon", "country", "population"])
            for row in _iter_geonames_rows(input_handle):
                name = row.get("name", "").strip()
                ascii_name = row.get("asciiname", "").strip()
                latitude = row.get("latitude", "").strip()
                longitude = row.get("longitude", "").strip()
                if not name or not latitude or not longitude:
                    continue
                aliases = row.get("alternatenames", "").strip().replace(",", "|")
                writer.writerow(
                    [
                        name,
                        ascii_name,
                        aliases,
                        latitude,
                        longitude,
                        row.get("country_code", "").strip(),
                        row.get("population", "0").strip() or "0",
                    ]
                )
                rows_written += 1
    return rows_written


def _download_zip(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "sky-monitor-api/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            with destination.open("wb") as handle:
                while chunk := response.read(1024 * 1024):
                    handle.write(chunk)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SystemExit(f"Could not download GeoNames city index: {url}") from exc


def build_city_index(output: Path = DEFAULT_OUTPUT, source: Path | None = None, url: str = DEFAULT_URL) -> int:
    if source is not None:
        return _write_city_index(source, output)

    with TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        zip_path = tmp_path / "cities1000.zip"
        _download_zip(url, zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extract("cities1000.txt", tmp_path)
        return _write_city_index(tmp_path / "cities1000.txt", output)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the browser-side city lookup TSV for the wiki.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source", type=Path, default=None, help="Optional local GeoNames cities1000.txt path.")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()

    rows = build_city_index(output=args.output, source=args.source, url=args.url)
    print(f"Wrote {rows} city rows to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
