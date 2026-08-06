"""Groq (llama-3.3-70b-versatile) interpretation of OCR'd dashboard text."""

from __future__ import annotations

import json
import os

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are an expert at reading heavy-truck instrument clusters
(BharatBenz / Tata / Ashok Leyland style) and handwritten driver trip cards.

You receive noisy OCR text extracted from one photo. Reconstruct the most likely
real readings. OCR confuses 0/O, 1/I/l, 5/S, 8/B, 2/Z, and often drops decimal
points. Use domain knowledge: odometer is km, engine hours are Hrs, battery is
typically 24-28 V, coolant/fuel are gauge positions, DEF/AdBlue is a bar gauge.

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
