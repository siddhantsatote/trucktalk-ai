import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, Truck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Truck Dashboard Reader — AI Instrument Cluster OCR" },
      {
        name: "description",
        content:
          "Upload photos of truck instrument clusters or handwritten trip cards and get structured odometer, engine hours, battery and trip data instantly.",
      },
      { property: "og:title", content: "Truck Dashboard Reader — AI Instrument Cluster OCR" },
      {
        property: "og:description",
        content:
          "AI reads truck dashboards and trip cards, returning odometer, engine hours, warnings and trip details as clean data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Result = {
  document_type?: string;
  vehicle?: { cluster_part_number?: string | null; cluster_name?: string | null };
  readings?: Record<string, string | number | null>;
  warning_lights?: string[];
  trip_card?: {
    company?: string | null;
    rows?: { trip?: string; machine_no?: string; loading_time?: string; remarks?: string }[];
  };
  summary?: string;
  maintenance_notes?: string[];
  confidence?: string;
  error?: string;
};

type Item = { id: string; name: string; url: string; loading: boolean; result?: Result };

const LABELS: Record<string, string> = {
  odometer_km: "Odometer (km)",
  service_trip_km: "Service trip (km)",
  engine_hours: "Engine hours",
  service_trip_hours: "Service trip (hrs)",
  battery_voltage: "Battery (V)",
  average_fuel_economy_kmpl: "Avg economy (km/l)",
  speed_kmph: "Speed (km/h)",
  rpm: "RPM",
  gear: "Gear",
  clock: "Clock",
  fuel_level: "Fuel level",
  def_level: "DEF / AdBlue",
  coolant_temp: "Coolant temp",
  drive_mode: "Drive mode",
  trip_distance: "Trip distance",
  trip_duration: "Trip duration",
  departure_time: "Departure",
  consumption: "Consumption",
};

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Index() {
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const dataUrl = await readFile(file);
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setItems((prev) => [...prev, { id, name: file.name, url: dataUrl, loading: true }]);
      try {
        const res = await fetch("/api/analyze-truck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, name: file.name }),
        });
        const json = (await res.json()) as Result;
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, loading: false, result: json } : i)));
      } catch (err) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, loading: false, result: { error: String(err) } } : i,
          ),
        );
      }
    }
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-10 flex items-center gap-3">
          <Truck className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Truck Dashboard Reader</h1>
            <p className="text-sm text-muted-foreground">
              Upload instrument cluster photos, trip computers or handwritten trip cards — AI turns them into truck data.
            </p>
          </div>
        </header>

        <Card
          className="flex cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-12 text-center transition-colors hover:bg-accent/40"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium text-foreground">Drop images here or click to upload</p>
          <p className="text-xs text-muted-foreground">JPG, PNG, WEBP — multiple files supported</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </Card>

        <div className="mt-10 space-y-8">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden p-6">
              <div className="grid gap-6 md:grid-cols-[280px_1fr]">
                <div>
                  <img src={item.url} alt={item.name} className="w-full rounded-md border border-border" />
                  <p className="mt-2 truncate text-xs text-muted-foreground">{item.name}</p>
                </div>
                <div>
                  {item.loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Reading the dashboard…
                    </div>
                  )}
                  {item.result?.error && (
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4" /> {item.result.error}
                    </div>
                  )}
                  {item.result && !item.result.error && (
                    <ResultView result={item.result} />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}

function ResultView({ result }: { result: Result }) {
  const readings = Object.entries(result.readings ?? {}).filter(
    ([, v]) => v !== null && v !== "" && v !== undefined,
  );
  const rows = result.trip_card?.rows ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{result.document_type ?? "unknown"}</Badge>
        {result.confidence && <Badge variant="outline">confidence: {result.confidence}</Badge>}
        {result.vehicle?.cluster_name && <Badge variant="outline">{result.vehicle.cluster_name}</Badge>}
      </div>

      {result.summary && <p className="text-sm text-foreground">{result.summary}</p>}

      {result.vehicle?.cluster_part_number && (
        <p className="text-xs text-muted-foreground">Part no: {result.vehicle.cluster_part_number}</p>
      )}

      {readings.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {readings.map(([key, value]) => (
            <div key={key} className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{LABELS[key] ?? key}</p>
              <p className="text-lg font-semibold text-foreground">{String(value)}</p>
            </div>
          ))}
        </div>
      )}

      {(result.warning_lights?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Warning lights</h3>
          <div className="flex flex-wrap gap-2">
            {result.warning_lights?.map((w) => (
              <Badge key={w} variant="destructive">
                {w}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Trip card{result.trip_card?.company ? ` — ${result.trip_card.company}` : ""}
          </h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left font-medium">Trip</th>
                  <th className="p-2 text-left font-medium">Machine no</th>
                  <th className="p-2 text-left font-medium">Loading time</th>
                  <th className="p-2 text-left font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{r.trip}</td>
                    <td className="p-2">{r.machine_no}</td>
                    <td className="p-2">{r.loading_time}</td>
                    <td className="p-2">{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(result.maintenance_notes?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Maintenance notes</h3>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {result.maintenance_notes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw JSON</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}
