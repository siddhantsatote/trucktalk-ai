"""CLI: python cli.py image1.jpg image2.jpg"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from truck_dashboard_ocr.llm import interpret  # noqa: E402
from truck_dashboard_ocr.ocr import extract_text  # noqa: E402


def main(paths: list[str]) -> int:
    if not paths:
        print("usage: python cli.py <image> [image ...]")
        return 1
    out = {}
    for path in paths:
        text = extract_text(Image.open(path))
        out[os.path.basename(path)] = interpret(text, filename=os.path.basename(path))
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
