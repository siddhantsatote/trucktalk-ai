"""OCR helpers for truck dashboard images."""

from __future__ import annotations

from PIL import Image, ImageEnhance, ImageOps
import pytesseract


def preprocess(image: Image.Image) -> Image.Image:
    """Boost contrast / grayscale so cluster digits read better."""
    img = ImageOps.exif_transpose(image).convert("L")
    # upscale small images, dashboards have tiny LCD digits
    w, h = img.size
    if max(w, h) < 1600:
        scale = 1600 / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    img = ImageOps.autocontrast(img)
    img = ImageEnhance.Sharpness(img).enhance(2.0)
    return img


def extract_text(image: Image.Image) -> str:
    """Run tesseract with a couple of page-segmentation modes and merge output."""
    prepared = preprocess(image)
    chunks = []
    for psm in (6, 11, 3):
        try:
            text = pytesseract.image_to_string(prepared, config=f"--oem 3 --psm {psm}")
        except Exception as exc:  # pragma: no cover - tesseract missing
            return f"[OCR error: {exc}]"
        text = text.strip()
        if text:
            chunks.append(f"--- psm {psm} ---\n{text}")
    return "\n\n".join(chunks) if chunks else "[no text detected]"
