"""Groq (llama-3.3-70b-versatile) interpretation of OCR'd dashboard text."""

from __future__ import annotations

import json
import os

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are an expert at reading heavy-truck instrument clusters
(BharatBenz / Tata / Ashok Leyland style) and handwritten driver trip cards.

You receive noisy OCR text extracted from ONE photo, usually as several labelled
variants of the same image. Reconcile them: a value confirmed by two variants is
reliable, a value seen once is a guess. OCR confuses 0/O, 1/I/l, 5/S, 8/B, 2/Z and
often drops decimal points. Use domain knowledge: odometer is km, engine hours are
Hrs, battery is typically 24-28 V, coolant/fuel/DEF are gauge positions.

Classification rules:
- Devanagari/Hindi text, a numbered table, or handwriting -> "trip_card".
- Gauge words (rpm, km/h, ODO, ENG, SERVICE TRIP, FUEL, TEMP, DEF) -> "instrument_cluster".

NEVER invent a reading. Analogue needles (speed, rpm, fuel, temp) cannot be read from
text, so leave them null unless the OCR literally shows the value. If a number has no
clear OCR support, use null and set confidence "low". Guessing is worse than null.


Return STRICT JSON only, no markdown, with this shape:
{
  "document_type": "instrument_cluster" | "trip_card" | "other",
  "vehicle": {"cluster_part_number": string|null, "cluster_name": string|null},
  "readings": {
    "odometer_km": number|null,
    "service_trip_km": number|null,
    "engine_hours": number|null,
    "service_trip_hours": number|null,
    "battery_voltage": number|null,
    "average_fuel_economy_kmpl": number|null,
    "speed_kmph": number|null,
    "rpm": number|null,
    "gear": string|null,
    "clock": string|null,
    "fuel_level": string|null,
    "def_level": string|null,
    "coolant_temp": string|null,
    "drive_mode": string|null
  },
  "warning_lights": [string],
  "trip_card": {"company": string|null, "rows": [{"trip": string, "machine_no": string, "loading_time": string, "remarks": string}]},
  "summary": string,
  "maintenance_notes": [string],
  "confidence": "high" | "medium" | "low"
}
Use null for anything not present. Never invent a value that has no OCR support."""


class GroqError(RuntimeError):
    pass


def interpret(ocr_text: str, api_key: str | None = None, filename: str = "") -> dict:
    key = api_key or os.environ.get("GROQ_API_KEY")
    if not key:
        raise GroqError("GROQ_API_KEY is not set")

    resp = requests.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"File: {filename}\n\nOCR TEXT:\n{ocr_text}",
                },
            ],
        },
        timeout=120,
    )
    if resp.status_code != 200:
        raise GroqError(f"Groq API {resp.status_code}: {resp.text[:400]}")

    content = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise GroqError(f"Model did not return JSON: {content[:400]}") from exc
