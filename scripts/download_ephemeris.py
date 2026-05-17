from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "data" / "de421.bsp"
DEFAULT_URL = "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de421.bsp"
MIN_EXPECTED_BYTES = 1_000_000


def download_ephemeris(output_path: Path, force: bool = False, url: str = DEFAULT_URL) -> Path:
    if output_path.exists() and not force:
        print(f"Ephemeris already exists: {output_path}")
        print("Use --force to overwrite it.")
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "rokid-sky-assistant/0.1"})
    tmp_path = output_path.with_suffix(f"{output_path.suffix}.tmp")

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            with tmp_path.open("wb") as handle:
                while chunk := response.read(1024 * 1024):
                    handle.write(chunk)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        if tmp_path.exists():
            tmp_path.unlink()
        print("Could not download Skyfield ephemeris automatically.", file=sys.stderr)
        print(f"Manual fallback: download {url} and save it as {output_path}", file=sys.stderr)
        raise SystemExit(str(exc)) from exc

    if tmp_path.stat().st_size < MIN_EXPECTED_BYTES:
        tmp_path.unlink()
        raise SystemExit(f"Downloaded file is too small to be a valid ephemeris: {url}")

    tmp_path.replace(output_path)
    print(f"Downloaded ephemeris to {output_path}")
    print(f"Bytes written: {output_path.stat().st_size}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Download JPL DE421 ephemeris for Skyfield.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    download_ephemeris(args.output, force=args.force, url=args.url)


if __name__ == "__main__":
    main()
