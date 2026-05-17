from __future__ import annotations

import argparse
import gzip
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "data" / "raw" / "hygdata_v3.csv"
DEFAULT_URLS = [
    "https://raw.githubusercontent.com/astronexus/HYG-Database/master/hygdata_v3.csv",
    "https://raw.github.com/astronexus/HYG-Database/master/hygdata_v3.csv",
    "https://www.astronexus.com/downloads/catalogs/hygdata_v3.csv.gz",
    "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv",
]


def _looks_like_hyg_csv(content: bytes) -> bool:
    first_line = content[:4096].decode("utf-8", errors="ignore").splitlines()[0].lower()
    required = {"ra", "dec", "mag"}
    columns = {item.strip().strip('"') for item in first_line.split(",")}
    return required.issubset(columns)


def _download(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "rokid-sky-assistant/0.1"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content = response.read()
        content_type = response.headers.get("Content-Type", "")

    if url.endswith(".gz") or "gzip" in content_type:
        content = gzip.decompress(content)
    return content


def download_hyg(output_path: Path, force: bool = False, urls: Optional[List[str]] = None) -> Path:
    if output_path.exists() and not force:
        print(f"Raw CSV already exists: {output_path}")
        print("Use --force to overwrite it.")
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    failures: List[str] = []
    for url in urls or DEFAULT_URLS:
        print(f"Trying {url}")
        try:
            content = _download(url, timeout=60)
            if not _looks_like_hyg_csv(content):
                failures.append(f"{url}: downloaded content is not a HYG CSV")
                continue
            output_path.write_bytes(content)
            print(f"Downloaded HYG catalog to {output_path}")
            print(f"Bytes written: {output_path.stat().st_size}")
            return output_path
        except (urllib.error.URLError, TimeoutError, OSError, gzip.BadGzipFile) as exc:
            failures.append(f"{url}: {exc}")

    print("Could not download HYG automatically.", file=sys.stderr)
    print("Manual fallback:", file=sys.stderr)
    print(
        "1. Download the current HYG CSV from https://github.com/astronexus/HYG-Database",
        file=sys.stderr,
    )
    print(f"2. Save it as {output_path}", file=sys.stderr)
    print("Failures:", file=sys.stderr)
    for failure in failures:
        print(f"- {failure}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the HYG star catalog CSV.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--url", action="append", help="Custom HYG CSV URL. Can be passed multiple times.")
    args = parser.parse_args()

    download_hyg(output_path=args.output, force=args.force, urls=args.url)


if __name__ == "__main__":
    main()
