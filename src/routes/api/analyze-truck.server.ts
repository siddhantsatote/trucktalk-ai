import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SYSTEM = `You are an expert OCR system for heavy-truck instrument clusters and trip computers.

RULES:
1. DECIMAL POINTS ARE CRITICAL. The value "702.2" must be reported as "702.2" NOT "7022". The value "58.2" must be "58.2" NOT "582". A tiny dot between digits changes everything.
2. Report ALL numeric readings as STRINGS to preserve exact formatting. For example: "702.2" not 702.2, "58.2" not 58.2, "346" not 346.
3. Read the display digit by digit, left to right. Look carefully at the bottom-right corner of each digit group for a small dot.
4. On seven-segment LCD: a small illuminated dot in the lower-right area of the display is a decimal point. A colon (:) separates hours from minutes in clocks/timers.
5. If you cannot clearly see a decimal, report the number as-is. Never invent or assume decimals.
6. If a value is not visible, use null. Never invent values.

Example readings from a typical truck trip computer display:
- "11:04" → clock/departure time → report as "11:04"
- "6:06hr" → duration → report as "6:06"
- "346mls" → distance → report as "346"
- "58.2mpg" → fuel economy → report as "58.2"
- "58.2mph" → speed → report as "58.2"
- "702.2" → engine hours → report as "702.2"

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

const inputSchema = z.object({ image: z.string(), name: z.string() });

export const analyzeTruckImage = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async (ctx) => {
    const { image, name } = ctx.data;
    try {
      const key = process.env["NVIDIA_API_KEY"];
      if (!key) {
        return { error: "Missing NVIDIA_API_KEY environment variable. Set it in your .env file." };
      }

      if (!image || typeof image !== "string") {
        return { error: "No image provided" };
      }

      let imageUrl: string;
      try {
        imageUrl = await compressImage(image);
      } catch {
        imageUrl = image;
      }

      const payloadSizeKB = Math.round(new TextEncoder().encode(JSON.stringify({ image: imageUrl })).byteLength / 1024);
      console.log(`[analyze-truck] Payload image size: ~${payloadSizeKB}KB`);

      const payload = {
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `File: ${name}. Extract the truck information as JSON.` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        max_tokens: 4096,
        temperature: 0.6,
        top_p: 0.95,
      };

      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { error: `NVIDIA API error (${response.status}): ${errorText.slice(0, 300)}` };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (!content) {
        return { error: "No content returned from AI model" };
      }

      try {
        return JSON.parse(content);
      } catch {
        return { summary: content, confidence: "low" };
      }
    } catch (err) {
      return { error: `Server error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
