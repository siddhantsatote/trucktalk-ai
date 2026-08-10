import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SYSTEM = `You are an expert at reading truck instrument clusters, trip computers, and handwritten trip cards.

IMPORTANT RULES:
1. DECIMAL POINTS: "702.2" must NOT be "7022". Look for small dots between digits. Always report as strings: "702.2" not 702.2.
2. DIGITAL READINGS: Read each digit left to right exactly as shown on the LCD/display.
3. ANALOG GAUGES (RPM, Speedometer, Fuel, Coolant Temp): These use a NEEDLE pointing to numbers on a circular dial. Look at where the needle points and estimate the value based on the scale markings. Common truck gauges:
   - RPM gauge: usually 0-3000 RPM, needle near bottom-left = ~800 idle, middle = ~1500
   - Speedometer: usually 0-160 km/h or 0-100 mph
   - Fuel gauge: E (empty) to F (full), or 0-100%
   - Coolant temp: usually 40-120°C, normal around 90°C
   If the needle is at the very bottom/zero position and engine appears off, report null.
4. WARNING LIGHTS: Describe the actual symbol/text visible (e.g. "check engine", "oil pressure", "battery", "ABS"). Do NOT just say colors like "red", "yellow".
5. If a value is truly not visible, use null. Never invent values.
6. CLOCK/TIMERS: "11:04" with a colon means time. "6:06hr" means 6 hours 6 minutes.

Return STRICT JSON only, no markdown:
{
  "document_type": "instrument_cluster" | "trip_computer" | "trip_card" | "other",
  "vehicle": {"cluster_part_number": string|null, "cluster_name": string|null},
  "readings": {
    "odometer_km": string|null,
    "service_trip_km": string|null,
    "engine_hours": string|null,
    "service_trip_hours": string|null,
    "battery_voltage": string|null,
    "average_fuel_economy_kmpl": string|null,
    "speed_kmph": string|null,
    "rpm": string|null,
    "gear": string|null,
    "clock": string|null,
    "fuel_level": string|null,
    "def_level": string|null,
    "coolant_temp": string|null,
    "drive_mode": string|null,
    "trip_distance": string|null,
    "trip_duration": string|null,
    "departure_time": string|null,
    "consumption": string|null
  },
  "warning_lights": [string],
  "trip_card": {"company": string|null, "rows": [{"trip": string, "machine_no": string, "loading_time": string, "remarks": string}]},
  "summary": string,
  "maintenance_notes": [string],
  "confidence": "high" | "medium" | "low"
}`;

const MAX_IMAGE_WIDTH = 800;
const MAX_IMAGE_HEIGHT = 800;
const JPEG_QUALITY = 0.85;

async function compressImage(dataUrl: string): Promise<string> {
  const parts = dataUrl.split(",");
  const header = parts[0] ?? "";
  const base64 = parts[1] ?? "";
  const mimeMatch = header.match(/data:(.*?);/);
  const mime = mimeMatch?.[1] ?? "image/jpeg";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  let targetW = width;
  let targetH = height;

  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  const arrayBuf = await outBlob.arrayBuffer();
  const arr = new Uint8Array(arrayBuf);
  let b64 = "";
  for (let i = 0; i < arr.length; i++) {
    const byte = arr[i];
    if (byte !== undefined) b64 += String.fromCharCode(byte);
  }

  return `data:image/jpeg;base64,${btoa(b64)}`;
}

type ProviderResult = { content: string; provider: string };

async function callGemini(imageUrl: string, fileName: string): Promise<ProviderResult> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("no GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `File: ${fileName}. Extract the truck information as JSON.` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        model: "gemini-2.0-flash",
        max_tokens: 4096,
        temperature: 0.1,
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Gemini returned empty");
  return { content, provider: "gemini" };
}

async function callGroq(imageUrl: string, fileName: string): Promise<ProviderResult> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("no GROQ_API_KEY");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: `File: ${fileName}. Extract the truck information as JSON.` },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      model: "qwen/qwen3.6-27b",
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Groq returned empty");
  return { content, provider: "groq" };
}

async function callNvidia(imageUrl: string, fileName: string): Promise<ProviderResult> {
  const key = process.env["NVIDIA_API_KEY"];
  if (!key) throw new Error("no NVIDIA_API_KEY");

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: `File: ${fileName}. Extract the truck information as JSON.` },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("NVIDIA returned empty");
  return { content, provider: "nvidia" };
}

function parseJsonFromContent(content: string): unknown {
  const trimmed = content.trim();

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }

  return JSON.parse(trimmed);
}

const DECIMAL_FIELDS: Record<string, { maxDigitsBeforeDot: number; defaultDotFromRight: number }> = {
  engine_hours: { maxDigitsBeforeDot: 3, defaultDotFromRight: 1 },
  service_trip_hours: { maxDigitsBeforeDot: 3, defaultDotFromRight: 1 },
  speed_kmph: { maxDigitsBeforeDot: 2, defaultDotFromRight: 1 },
  average_fuel_economy_kmpl: { maxDigitsBeforeDot: 2, defaultDotFromRight: 1 },
  battery_voltage: { maxDigitsBeforeDot: 2, defaultDotFromRight: 1 },
  rpm: { maxDigitsBeforeDot: 4, defaultDotFromRight: 0 },
  fuel_level: { maxDigitsBeforeDot: 3, defaultDotFromRight: 0 },
  coolant_temp: { maxDigitsBeforeDot: 3, defaultDotFromRight: 0 },
  odometer_km: { maxDigitsBeforeDot: 5, defaultDotFromRight: 1 },
  service_trip_km: { maxDigitsBeforeDot: 5, defaultDotFromRight: 1 },
  trip_distance: { maxDigitsBeforeDot: 5, defaultDotFromRight: 1 },
  consumption: { maxDigitsBeforeDot: 3, defaultDotFromRight: 1 },
};

function fixMissingDecimals(parsed: Record<string, unknown>): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") return parsed;

  const readings = parsed.readings as Record<string, string | null> | undefined;
  if (!readings || typeof readings !== "object") return parsed;

  const fixed = { ...readings };

  for (const [key, config] of Object.entries(DECIMAL_FIELDS)) {
    const val = fixed[key];
    if (typeof val !== "string") continue;
    if (val.includes(".") || val.includes(":")) continue;

    const digits = val.replace(/[^0-9]/g, "");
    if (!digits) continue;

    const num = parseInt(digits, 10);
    if (isNaN(num)) continue;

    if (digits.length <= config.maxDigitsBeforeDot) continue;

    const dotPos = digits.length - config.defaultDotFromRight;
    if (dotPos <= 0 || dotPos >= digits.length) continue;

    const withDot = digits.slice(0, dotPos) + "." + digits.slice(dotPos);
    fixed[key] = withDot;
  }

  return { ...parsed, readings: fixed };
}

const inputSchema = z.object({ image: z.string(), name: z.string() });

export const analyzeTruckImage = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async (ctx) => {
    const { image, name } = ctx.data;
    if (!image || typeof image !== "string") {
      return { error: "No image provided" };
    }

    let imageUrl: string;
    try {
      imageUrl = await compressImage(image);
    } catch {
      imageUrl = image;
    }

    const providers = [callGemini, callGroq, callNvidia];
    const errors: string[] = [];

    for (const provider of providers) {
      try {
        const result = await provider(imageUrl, name);
        console.log(`[analyze-truck] Success with ${result.provider}`);
        try {
          const parsed = parseJsonFromContent(result.content);
          return fixMissingDecimals(parsed as Record<string, unknown>);
        } catch {
          return { summary: result.content, confidence: "low" };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[analyze-truck] ${msg}`);
        errors.push(msg);
      }
    }

    return {
      error: `All providers failed: ${errors.join(" | ")}`,
    };
  });
