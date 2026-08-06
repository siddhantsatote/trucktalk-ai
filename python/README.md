# Truck Dashboard Reader (OCR + Llama 3.3 70B)

Reads photos of heavy-truck instrument clusters and handwritten driver trip cards,
extracts the text with Tesseract OCR, and has Llama 3.3 70B (via Groq) turn the noisy
OCR into clean, structured truck information (odometer, engine hours, service trip,
battery voltage, fuel/DEF levels, warning lights, trip-card rows, maintenance notes).

## Setup

```bash
cd python
python -m pip install -r requirements.txt
# system dependency
sudo apt-get install -y tesseract-ocr
export GROQ_API_KEY=...   # already configured in this project
```

## Run the upload UI

```bash
streamlit run truck_dashboard_ocr/app.py
```

Then drag & drop one or more `.jpg/.png` dashboard photos.

## Run from the terminal

```bash
python cli.py /path/to/dashboard.jpg
```

Outputs JSON per image.
