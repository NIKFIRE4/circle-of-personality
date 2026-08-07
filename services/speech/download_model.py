from __future__ import annotations

import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

MODEL_BASE_URL = "https://cdn.chatwm.opensmodel.sberdevices.ru/GigaAM"
MODEL_FILES = {
    "v3_e2e_rnnt.ckpt": "2730de7545ac43ad256485a462b0a27a",
    "v3_e2e_rnnt_tokenizer.model": None,
}


def md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(target_dir: Path, filename: str, expected_md5: str | None) -> None:
    target = target_dir / filename
    if target.is_file() and target.stat().st_size > 0:
        if expected_md5 is None or md5(target) == expected_md5:
            return

    temporary = target.with_suffix(target.suffix + ".part")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(
        f"{MODEL_BASE_URL}/{filename}",
        headers={"User-Agent": "kontur-kostrov-vercel-build/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as source:
            with temporary.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)

        if temporary.stat().st_size == 0:
            raise RuntimeError(f"Downloaded an empty file: {filename}")
        if expected_md5 is not None and md5(temporary) != expected_md5:
            raise RuntimeError(f"Checksum mismatch for {filename}")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: download_model.py TARGET_DIRECTORY")
    target_dir = Path(sys.argv[1]).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    for filename, expected_md5 in MODEL_FILES.items():
        download(target_dir, filename, expected_md5)


if __name__ == "__main__":
    main()
