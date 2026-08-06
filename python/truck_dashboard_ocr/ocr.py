"""OCR helpers for truck dashboard images.

Instrument clusters are hard for OCR: bright LCD digits on black, glare, and
handwritten trip cards. We therefore run several preprocessing variants and
page-segmentation modes, then hand every candidate reading to the LLM, which
reconciles them.
"""

from __future__ import annotations

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import pytesseract

MIN_SIDE = 2200


def _base(image: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(image).convert("L")
    w, h = img.size
    if max(w, h) < MIN_SIDE:
        scale = MIN_SIDE / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


def _variants(image: Image.Image) -> list[tuple[str, Image.Image]]:
    base = _base(image)
    autoc = ImageOps.autocontrast(base, cutoff=2)
    sharp = ImageEnhance.Sharpness(autoc).enhance(2.5)

    # Bright LCD text on a dark cluster: threshold high, then invert to dark-on-light.
    lcd = sharp.point(lambda p: 255 if p > 165 else 0).convert("L")
    lcd = ImageOps.invert(lcd)

    # Handwriting / paper documents: gentle adaptive-ish threshold.
    paper = sharp.filter(ImageFilter.MedianFilter(3)).point(lambda p: 255 if p > 120 else 0)

    # Zoomed centre panel: on a cluster photo this is the LCD info display.
    w, h = base.size
    centre = base.crop((int(w * 0.30), int(h * 0.32), int(w * 0.72), int(h * 0.92)))
    centre = centre.resize((centre.width * 2, centre.height * 2), Image.LANCZOS)
    centre = ImageOps.invert(
        ImageOps.autocontrast(centre, cutoff=2).point(lambda p: 255 if p > 150 else 0)
    )

    return [("contrast", sharp), ("lcd", lcd), ("paper", paper), ("lcd-zoom", centre)]



def _run(img: Image.Image, psm: int, whitelist: str | None = None) -> str:
    config = f"--oem 3 --psm {psm}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    try:
        return pytesseract.image_to_string(img, config=config).strip()
    except Exception as exc:  # pragma: no cover - tesseract missing
        return f"[OCR error: {exc}]"


def extract_text(image: Image.Image) -> str:
    """Return a labelled bundle of OCR candidates for the LLM to reconcile."""
    chunks: list[str] = []
    for name, img in _variants(image):
        for psm in (6, 11):
            text = _run(img, psm)
            if text and text not in ("",):
                chunks.append(f"--- variant={name} psm={psm} ---\n{text}")
        if name == "lcd":
            digits = _run(img, 11, "0123456789.:VkmHrsPAM")
            if digits:
                chunks.append(f"--- variant=lcd digits-only ---\n{digits}")
    return "\n\n".join(chunks) if chunks else "[no text detected]"
