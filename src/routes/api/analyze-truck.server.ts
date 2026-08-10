import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SYSTEM = `You are an OCR system for truck instrument clusters. You read images and output data.

DO NOT explain your thinking. DO NOT describe what you see. ONLY output the JSON object below.

Rules:
- Report ALL readings as strings (e.g. "742.2" not 742.2)
- Look for decimal points (dots) between digits — they are critical
- For analog gauges (RPM, fuel, speed, coolant): read where the needle points on the dial
- For digital displays: read each digit exactly as shown
- If not visible, use null
- Clock uses colons (12:05 PM), timers use colons (6:06hr)

Output ONLY this JSON, nothing else:
{"document_type":"instrument_cluster","vehicle":{"cluster_part_number":null,"cluster_name":null},"readings":{"odometer_km":null,"service_trip_km":null,"engine_hours":null,"service_trip_hours":null,"battery_voltage":null,"average_fuel_economy_kmpl":null,"speed_kmph":null,"rpm":null,"gear":null,"clock":null,"fuel_level":null,"def_level":null,"coolant_temp":null,"drive_mode":null,"trip_distance":null,"trip_duration":null,"departure_time":null,"consumption":null},"warning_lights":[],"trip_card":null,"summary":"","maintenance_notes":[],"confidence":"high"}`;

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
        response_format: { type: "json_object" },
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
      response_format: { type: "json_object" },
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

function stripThinkingTags(content: string): string {
  let result = content;
  // Remove complete thinking blocks
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, "");
  result = result.replace(/<think>[\s\S]*?<｜end▁of▁thinking｜>/gi, "");
  result = result.replace(/<\|begin▁of▁thinking\|>[\s\S]*?<\|end▁of▁thinking\|>/gi, "");
  // Remove unclosed thinking blocks (from <think> to end of string)
  result = result.replace(/<think>[\s\S]*/gi, "");
  return result.trim();
}

function parseJsonFromContent(content: string): unknown {
  const cleaned = stripThinkingTags(content);
  const trimmed = cleaned.trim();

  // First: try to find JSON in code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through to try other methods
    }
  }

  // Second: try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through
  }

  // Third: find the FIRST { ... } JSON block in the response
  // This handles cases where thinking text precedes the JSON
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
    } catch {
      // Fall through
    }
  }

  // Fourth: try to find any JSON object by matching braces
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Fall through
    }
  }

  throw new Error("No valid JSON found in response");
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
          const cleaned = stripThinkingTags(result.content);
          return { summary: cleaned.slice(0, 500), confidence: "low", provider: result.provider };
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
