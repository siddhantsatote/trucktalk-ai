import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, Truck, AlertTriangle, Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { analyzeTruckImage } from "./api/analyze-truck.server";

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
  provider?: string;
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

function compressImageClient(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 800;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        const scale = Math.min(MAX / w, MAX / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function Index() {
  const [kmSlot, setKmSlot] = useState<{
    file?: File;
    url?: string;
    loading: boolean;
    result?: Result;
    error?: string;
  }>({ loading: false });

  const [hrSlot, setHrSlot] = useState<{
    file?: File;
    url?: string;
    loading: boolean;
    result?: Result;
    error?: string;
  }>({ loading: false });

  const kmFileInputRef = useRef<HTMLInputElement>(null);
  const kmCameraInputRef = useRef<HTMLInputElement>(null);
  const hrFileInputRef = useRef<HTMLInputElement>(null);
  const hrCameraInputRef = useRef<HTMLInputElement>(null);

  const processKmFile = useCallback(async (file: File) => {
    const dataUrl = await compressImageClient(file);
    setKmSlot({ file, url: dataUrl, loading: true });
    try {
      const response = await analyzeTruckImage({ data: { image: dataUrl, name: file.name } });
      const json = (response as { data?: Result })?.data ?? (response as Result);
      setKmSlot((prev) => ({ ...prev, loading: false, result: json }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setKmSlot((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  const processHrFile = useCallback(async (file: File) => {
    const dataUrl = await compressImageClient(file);
    setHrSlot({ file, url: dataUrl, loading: true });
    try {
      const response = await analyzeTruckImage({ data: { image: dataUrl, name: file.name } });
      const json = (response as { data?: Result })?.data ?? (response as Result);
      setHrSlot((prev) => ({ ...prev, loading: false, result: json }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setHrSlot((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  const clearAll = useCallback(() => {
    setKmSlot({ loading: false });
    setHrSlot({ loading: false });
    if (kmFileInputRef.current) kmFileInputRef.current.value = "";
    if (kmCameraInputRef.current) kmCameraInputRef.current.value = "";
    if (hrFileInputRef.current) hrFileInputRef.current.value = "";
    if (hrCameraInputRef.current) hrCameraInputRef.current.value = "";
  }, []);

  const hasAnyResult = Boolean(kmSlot.result || hrSlot.result || kmSlot.url || hrSlot.url);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <Truck className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Truck Dashboard Reader
              </h1>
              <p className="text-sm text-muted-foreground">
                Capture or upload KM & HR dashboards — merged into 1 vehicle report.
              </p>
            </div>
          </div>
          {hasAnyResult && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent sm:mt-0"
            >
              Reset / Scan New Vehicle
            </button>
          )}
        </header>

        {/* Dual Upload/Capture Slots */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* SLOT 1: KM DASHBOARD */}
          <Card className="flex flex-col overflow-hidden border-2 border-border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">
                  Dashboard 1
                </Badge>
                <span className="font-semibold text-foreground">Odometer (KM)</span>
              </div>
              {kmSlot.result?.readings?.["odometer_km"] && (
                <Badge variant="outline" className="border-blue-500 text-blue-500 font-mono">
                  {String(kmSlot.result.readings["odometer_km"])} km
                </Badge>
              )}
            </div>

            {kmSlot.url ? (
              <div className="relative mb-4 overflow-hidden rounded-lg border border-border bg-muted/40">
                <img
                  src={kmSlot.url}
                  alt="KM Dashboard"
                  className="max-h-56 w-full object-contain"
                />
                {kmSlot.loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-xs">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm font-medium">Extracting KM...</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/30"
                onClick={() => kmFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void processKmFile(file);
                }}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Upload KM Dashboard Image</p>
                <p className="text-xs text-muted-foreground">Click or drop file (JPG, PNG)</p>
              </div>
            )}

            {/* Action Buttons for KM */}
            <div className="mt-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => kmFileInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
              >
                <Upload className="h-4 w-4" />
                {kmSlot.url ? "Change KM Image" : "Upload Image"}
              </button>
              <button
                type="button"
                onClick={() => kmCameraInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Camera className="h-4 w-4" />
                Capture Photo
              </button>
            </div>
            <input
              ref={kmFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void processKmFile(file);
              }}
            />
            <input
              ref={kmCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void processKmFile(file);
              }}
            />
          </Card>

          {/* SLOT 2: HR DASHBOARD */}
          <Card className="flex flex-col overflow-hidden border-2 border-border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                  Dashboard 2
                </Badge>
                <span className="font-semibold text-foreground">Engine Hours (HR)</span>
              </div>
              {hrSlot.result?.readings?.["engine_hours"] && (
                <Badge variant="outline" className="border-emerald-500 text-emerald-500 font-mono">
                  {String(hrSlot.result.readings["engine_hours"])} hrs
                </Badge>
              )}
            </div>

            {hrSlot.url ? (
              <div className="relative mb-4 overflow-hidden rounded-lg border border-border bg-muted/40">
                <img
                  src={hrSlot.url}
                  alt="HR Dashboard"
                  className="max-h-56 w-full object-contain"
                />
                {hrSlot.loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-xs">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm font-medium">Extracting HR...</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/30"
                onClick={() => hrFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void processHrFile(file);
                }}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Upload HR Dashboard Image</p>
                <p className="text-xs text-muted-foreground">Click or drop file (JPG, PNG)</p>
              </div>
            )}

            {/* Action Buttons for HR */}
            <div className="mt-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => hrFileInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
              >
                <Upload className="h-4 w-4" />
                {hrSlot.url ? "Change HR Image" : "Upload Image"}
              </button>
              <button
                type="button"
                onClick={() => hrCameraInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Camera className="h-4 w-4" />
                Capture Photo
              </button>
            </div>

            <input
              ref={hrFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void processHrFile(file);
              }}
            />
            <input
              ref={hrCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void processHrFile(file);
              }}
            />
          </Card>
        </div>

        {/* CONSOLIDATED SINGLE DASHBOARD OUTPUT */}
        {(kmSlot.result || hrSlot.result || kmSlot.error || hrSlot.error) && (
          <div className="mt-8">
            <Card className="p-6 border-2 border-primary/20 shadow-md">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    Vehicle Dashboard Summary
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Consolidated readings extracted from dashboard images
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Combined Output</Badge>
                  {(kmSlot.result?.provider || hrSlot.result?.provider) && (
                    <Badge variant="outline">
                      Provider: {kmSlot.result?.provider ?? hrSlot.result?.provider}
                    </Badge>
                  )}
                </div>
              </div>

              {/* PRIMARY METRICS: KM & HR */}
              <CombinedMetricsView kmSlot={kmSlot} hrSlot={hrSlot} />
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function CombinedMetricsView({
  kmSlot,
  hrSlot,
}: {
  kmSlot: { result?: Result; loading: boolean; error?: string };
  hrSlot: { result?: Result; loading: boolean; error?: string };
}) {
  const kmReadings = kmSlot.result?.readings;
  const hrReadings = hrSlot.result?.readings;

  // Extract KM: try KM slot first, then fallback to HR slot if detected there
  const odometerValue =
    kmReadings?.["odometer_km"] ??
    hrReadings?.["odometer_km"] ??
    kmReadings?.["service_trip_km"] ??
    null;

  // Extract HR: try HR slot first, then fallback to KM slot if detected there
  const engineHoursValue =
    hrReadings?.["engine_hours"] ??
    kmReadings?.["engine_hours"] ??
    hrReadings?.["service_trip_hours"] ??
    null;

  // Merge all other readings
  const mergedReadings: Record<string, string | number | null> = {
    ...kmReadings,
    ...hrReadings,
  };

  // Remaining readings excluding odometer and engine hours
  const extraReadings = Object.entries(mergedReadings).filter(
    ([k, v]) =>
      k !== "odometer_km" &&
      k !== "engine_hours" &&
      v !== null &&
      v !== "" &&
      v !== undefined,
  );

  const errors = [kmSlot.error, hrSlot.error].filter(Boolean);

  return (
    <div className="space-y-6">
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errors.join(" | ")}</span>
        </div>
      )}

      {/* HIGHLIGHTED DUAL CARDS FOR KM & HR */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* KM CARD */}
        <div className="rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Odometer Reading (KM)
            </span>
            <Badge variant="outline" className="border-blue-500 text-blue-600 dark:text-blue-400">
              Distance
            </Badge>
          </div>
          <div className="mt-3">
            {kmSlot.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Reading KM...
              </div>
            ) : odometerValue !== null && odometerValue !== undefined ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                  {String(odometerValue)}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">KM</span>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground py-2">
                Not detected — please capture or upload KM dashboard photo
              </p>
            )}
          </div>
        </div>

        {/* HR CARD */}
        <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/5 p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Engine Hours (HR)
            </span>
            <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400">
              Operating Time
            </Badge>
          </div>
          <div className="mt-3">
            {hrSlot.loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Reading HR...
              </div>
            ) : engineHoursValue !== null && engineHoursValue !== undefined ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                  {String(engineHoursValue)}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">Hrs</span>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground py-2">
                Not detected — please capture or upload HR dashboard photo
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ADDITIONAL METRICS IF DETECTED */}
      {extraReadings.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Additional Detected Telemetry
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {extraReadings.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{LABELS[key] ?? key}</p>
                <p className="text-base font-semibold text-foreground">{String(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RAW JSON DETAILS */}
      <details className="text-xs text-muted-foreground pt-2">
        <summary className="cursor-pointer font-medium hover:text-foreground">
          View Detailed JSON
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {kmSlot.result && (
            <div>
              <p className="font-semibold text-xs mb-1">KM Image Result JSON</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px]">
                {JSON.stringify(kmSlot.result, null, 2)}
              </pre>
            </div>
          )}
          {hrSlot.result && (
            <div>
              <p className="font-semibold text-xs mb-1">HR Image Result JSON</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px]">
                {JSON.stringify(hrSlot.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

