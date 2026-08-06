import { createFileRoute } from "@tanstack/react-router";

const SYSTEM = `You are an expert at reading heavy-truck instrument clusters (BharatBenz / Tata / Ashok Leyland style),
in-cab trip computers, and handwritten driver trip cards (often Hindi/Devanagari).

Read the IMAGE directly and report exactly what is shown. Read seven-segment LCD digits carefully,
including decimal points (e.g. 11053.7 km, 742.2 Hrs). Read analogue needles (speed, rpm, fuel, temp)
by needle position. If a value truly is not visible, use null. Never invent values.

Return STRICT JSON only, no markdown:
{
  "document_type": "instrument_cluster" | "trip_computer" | "trip_card" | "other",
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

export const Route = createFileRoute("/api/analyze-truck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { image, name } = (await request.json()) as { image: string; name?: string };
        if (!image) return Response.json({ error: "No image provided" }, { status: 400 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Lovable-API-Key": key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3.6-flash",
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: [
                  { type: "text", text: `File: ${name ?? "upload"}. Extract the truck information.` },
                  { type: "image_url", image_url: { url: image } },
                ],
              },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          if (upstream.status === 429)
            return Response.json({ error: "Rate limit reached, please retry shortly." }, { status: 429 });
          if (upstream.status === 402)
            return Response.json({ error: "AI credits exhausted. Please add credits." }, { status: 402 });
          return Response.json({ error: text.slice(0, 400) }, { status: upstream.status });
        }

        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        try {
          return Response.json(JSON.parse(content));
        } catch {
          return Response.json({ error: "Model did not return JSON", raw: content }, { status: 502 });
        }
      },
    },
  },
});
