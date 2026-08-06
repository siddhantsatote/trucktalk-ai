"""Streamlit UI: upload truck dashboard photos -> OCR -> LLM -> truck info."""

from __future__ import annotations

import json
import os
import sys

import streamlit as st
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from truck_dashboard_ocr.llm import GroqError, interpret  # noqa: E402
from truck_dashboard_ocr.ocr import extract_text  # noqa: E402

st.set_page_config(page_title="Truck Dashboard Reader", page_icon="🚛", layout="wide")

st.title("🚛 Truck Dashboard Reader")
st.caption("OCR + Llama 3.3 70B (Groq) — upload instrument cluster photos or trip cards")

with st.sidebar:
    st.header("Settings")
    key_from_env = bool(os.environ.get("GROQ_API_KEY"))
    st.write("GROQ_API_KEY:", "✅ loaded from environment" if key_from_env else "❌ missing")
    api_key = st.text_input("Override API key", type="password") or None
    show_raw_ocr = st.checkbox("Show raw OCR text", value=False)

files = st.file_uploader(
    "Upload dashboard / trip card images",
    type=["jpg", "jpeg", "png", "webp", "bmp"],
    accept_multiple_files=True,
)

LABELS = {
    "odometer_km": "Odometer (km)",
    "service_trip_km": "Service trip (km)",
    "engine_hours": "Engine hours",
    "service_trip_hours": "Service trip (hrs)",
    "battery_voltage": "Battery (V)",
    "average_fuel_economy_kmpl": "Avg fuel economy (km/l)",
    "speed_kmph": "Speed (km/h)",
    "rpm": "RPM",
    "gear": "Gear",
    "clock": "Clock",
    "fuel_level": "Fuel level",
    "def_level": "DEF / AdBlue",
    "coolant_temp": "Coolant temp",
    "drive_mode": "Drive mode",
}


def render(result: dict) -> None:
    st.success(result.get("summary") or "Analysis complete")

    vehicle = result.get("vehicle") or {}
    if any(vehicle.values()):
        st.write(
            f"**Cluster:** {vehicle.get('cluster_name') or '—'} · "
            f"**Part no:** {vehicle.get('cluster_part_number') or '—'}"
        )

    readings = {k: v for k, v in (result.get("readings") or {}).items() if v not in (None, "")}
    if readings:
        st.subheader("Readings")
        items = list(readings.items())
        cols = st.columns(4)
        for i, (key, value) in enumerate(items):
            cols[i % 4].metric(LABELS.get(key, key), str(value))

    warnings = result.get("warning_lights") or []
    if warnings:
        st.subheader("Warning lights")
        for w in warnings:
            st.warning(w)

    trip = result.get("trip_card") or {}
    rows = trip.get("rows") or []
    if rows:
        st.subheader(f"Trip card{' — ' + trip['company'] if trip.get('company') else ''}")
        st.dataframe(rows, width="stretch")

    notes = result.get("maintenance_notes") or []
    if notes:
        st.subheader("Maintenance notes")
        for n in notes:
            st.write("• " + n)

    st.caption(f"Confidence: {result.get('confidence', 'unknown')}")
    with st.expander("Raw JSON"):
        st.json(result)


if files:
    for file in files:
        st.divider()
        st.subheader(file.name)
        left, right = st.columns([1, 2])
        image = Image.open(file)
        left.image(image, width="stretch")

        with right:
            with st.spinner("Reading image…"):
                text = extract_text(image)
            if show_raw_ocr:
                with st.expander("Raw OCR text"):
                    st.code(text)
            try:
                with st.spinner("Interpreting with Llama 3.3 70B…"):
                    result = interpret(text, api_key=api_key, filename=file.name)
            except GroqError as exc:
                st.error(str(exc))
                continue
            render(result)
            st.download_button(
                "Download JSON",
                data=json.dumps(result, indent=2),
                file_name=f"{os.path.splitext(file.name)[0]}.json",
                mime="application/json",
                key=f"dl-{file.name}",
            )
else:
    st.info("Upload one or more photos to begin.")
