import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import type { AnalysisLayerResponse, CameraScenario, Region } from "../shared/types";

type Workflow = "saved" | "csv" | "optimize";

const defaultBounds = {
  north: 28.6165,
  south: 28.6128,
  east: 77.232,
  west: 77.226,
};

function App() {
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [scenarios, setScenarios] = useState<CameraScenario[]>([]);
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [workflow, setWorkflow] = useState<Workflow>("saved");
  const [bounds, setBounds] = useState(defaultBounds);
  const [regionName, setRegionName] = useState("Demo region");
  const [csvName, setCsvName] = useState("CSV camera set");
  const [csvText, setCsvText] = useState("camera,lat,long,orientation_deg,fov_deg,range_m\nCAM-1,28.6146,77.2288,70,75,90");
  const [optimize, setOptimize] = useState({ fov_deg: 80, range_m: 90, max_cameras: 24 });
  const [analysis, setAnalysis] = useState<AnalysisLayerResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const selectedRegion = useMemo(() => regions.find((region) => region.id === regionId) ?? null, [regions, regionId]);

  useEffect(() => {
    const map = L.map("map", { zoomControl: true }).setView([defaultBounds.south, defaultBounds.west], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layers;
    void loadRegions();
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (regionId !== null) void loadScenarios(regionId);
  }, [regionId]);

  useEffect(() => {
    if (analysis) renderAnalysis(analysis);
  }, [analysis]);

  async function loadRegions() {
    const data = await api<Region[]>("/api/regions");
    setRegions(data);
    if (data[0]) applyRegionDefaults(data[0]);
  }

  async function loadScenarios(nextRegionId: number) {
    const data = await api<CameraScenario[]>(`/api/regions/${nextRegionId}/scenarios`);
    setScenarios(data);
    setScenarioId(data[0]?.id ?? null);
  }

  async function createNewRegion() {
    await runTask("Creating region", async () => {
      const region = await api<Region>("/api/regions", {
        method: "POST",
        body: JSON.stringify({ name: regionName, ...bounds }),
      });
      setRegions((current) => [region, ...current.filter((item) => item.id !== region.id)]);
      applyRegionDefaults(region);
      setStatus("Region created");
    });
  }

  async function importBuildings() {
    if (!regionId) return;
    await runTask("Importing buildings from OpenStreetMap", async () => {
      const response = await api<{ imported: number }>(`/api/regions/${regionId}/import-buildings`, { method: "POST" });
      setStatus(`Imported ${response.imported} building footprint(s)`);
    });
  }

  async function uploadCsv() {
    if (!regionId) return;
    await runTask("Uploading CSV camera set", async () => {
      const scenario = await api<CameraScenario>(`/api/regions/${regionId}/scenarios/upload-csv?name=${encodeURIComponent(csvName)}`, {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: csvText,
      });
      setScenarioId(scenario.id);
      await loadScenarios(regionId);
      const result = await api<AnalysisLayerResponse>(`/api/scenarios/${scenario.id}/analyze`, { method: "POST" });
      setAnalysis(result);
      setStatus("CSV scenario analyzed");
    });
  }

  async function analyzeSaved() {
    if (!scenarioId) return;
    await runTask("Running blindspot analysis", async () => {
      const result = await api<AnalysisLayerResponse>(`/api/scenarios/${scenarioId}/analyze`, { method: "POST" });
      setAnalysis(result);
      setStatus("Scenario analyzed");
    });
  }

  async function optimizePlacement() {
    if (!regionId) return;
    await runTask("Optimizing camera placement", async () => {
      const result = await api<AnalysisLayerResponse>(`/api/regions/${regionId}/optimize`, {
        method: "POST",
        body: JSON.stringify(optimize),
      });
      setAnalysis(result);
      setScenarioId(result.scenario.id);
      await loadScenarios(regionId);
      setStatus(`Optimized ${result.cameras.features.length} camera placement(s)`);
    });
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(true);
    setStatus(label);
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  function renderAnalysis(result: AnalysisLayerResponse) {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    const regionLayer = L.geoJSON(regionFeature(result.region), {
      style: { color: "#263238", weight: 2, fillOpacity: 0 },
    }).addTo(layers);
    L.geoJSON(result.buildings, {
      style: { color: "#5d4037", weight: 1, fillColor: "#8d6e63", fillOpacity: 0.45 },
    }).addTo(layers);
    L.geoJSON(result.coverage, {
      style: { color: "#1976d2", weight: 1, fillColor: "#42a5f5", fillOpacity: 0.22 },
    }).addTo(layers);
    L.geoJSON(result.groundBlindspots, {
      style: { color: "#d32f2f", weight: 0.5, fillColor: "#ef5350", fillOpacity: 0.35 },
    }).addTo(layers);
    L.geoJSON(result.wallBlindspots, {
      style: { color: "#b71c1c", weight: 4, opacity: 0.9 },
    }).addTo(layers);
    L.geoJSON(result.wallNormals, {
      style: { color: "#00897b", weight: 1, opacity: 0.65 },
    }).addTo(layers);
    L.geoJSON(result.cameras, {
      pointToLayer: (feature, latlng) =>
        L.marker(latlng, {
          icon: L.divIcon({
            className: "camera-marker",
            html: `<span style="transform: rotate(${feature.properties?.orientation_deg ?? 0}deg)"></span>`,
            iconSize: [24, 24],
          }),
        }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
          `<strong>${feature.properties?.camera ?? "Camera"}</strong><br>FOV ${feature.properties?.fov_deg} deg<br>Range ${feature.properties?.range_m} m`,
        );
      },
    }).addTo(layers);

    map.fitBounds(regionLayer.getBounds(), { padding: [24, 24] });
  }

  function fitRegion(region: Region) {
    mapRef.current?.fitBounds(
      [
        [region.south, region.west],
        [region.north, region.east],
      ],
      { padding: [24, 24] },
    );
  }

  function applyRegionDefaults(region: Region) {
    setRegionId(region.id);
    setBounds({
      north: region.north,
      south: region.south,
      east: region.east,
      west: region.west,
    });
    setRegionName(region.name);
    fitRegion(region);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header>
          <h1>CCTV Blindspot Mapper</h1>
          <p>{status}</p>
        </header>

        <section>
          <h2>Region</h2>
          <label>
            Saved region
            <select
              value={regionId ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRegionId(value || null);
                const region = regions.find((item) => item.id === value);
                if (region) applyRegionDefaults(region);
              }}
            >
              <option value="">None</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-two">
            <NumberInput label="North" value={bounds.north} onChange={(value) => setBounds({ ...bounds, north: value })} />
            <NumberInput label="South" value={bounds.south} onChange={(value) => setBounds({ ...bounds, south: value })} />
            <NumberInput label="East" value={bounds.east} onChange={(value) => setBounds({ ...bounds, east: value })} />
            <NumberInput label="West" value={bounds.west} onChange={(value) => setBounds({ ...bounds, west: value })} />
          </div>
          <label>
            Name
            <input value={regionName} onChange={(event) => setRegionName(event.target.value)} />
          </label>
          <div className="button-row">
            <button onClick={createNewRegion} disabled={busy}>
              Create
            </button>
            <button onClick={importBuildings} disabled={busy || !selectedRegion}>
              Import OSM
            </button>
          </div>
        </section>

        <section>
          <h2>Camera Input</h2>
          <div className="segmented">
            <button className={workflow === "saved" ? "active" : ""} onClick={() => setWorkflow("saved")}>
              Saved
            </button>
            <button className={workflow === "csv" ? "active" : ""} onClick={() => setWorkflow("csv")}>
              CSV
            </button>
            <button className={workflow === "optimize" ? "active" : ""} onClick={() => setWorkflow("optimize")}>
              Optimize
            </button>
          </div>

          {workflow === "saved" && (
            <div className="workflow">
              <label>
                Scenario
                <select value={scenarioId ?? ""} onChange={(event) => setScenarioId(Number(event.target.value) || null)}>
                  <option value="">None</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name} ({scenario.camera_count ?? 0})
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={analyzeSaved} disabled={busy || !scenarioId}>
                Analyze
              </button>
            </div>
          )}

          {workflow === "csv" && (
            <div className="workflow">
              <label>
                Scenario name
                <input value={csvName} onChange={(event) => setCsvName(event.target.value)} />
              </label>
              <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} />
              <button onClick={uploadCsv} disabled={busy || !regionId}>
                Upload and Analyze
              </button>
            </div>
          )}

          {workflow === "optimize" && (
            <div className="workflow">
              <div className="grid-two">
                <NumberInput
                  label="FOV deg"
                  value={optimize.fov_deg}
                  onChange={(value) => setOptimize({ ...optimize, fov_deg: value })}
                />
                <NumberInput
                  label="Range m"
                  value={optimize.range_m}
                  onChange={(value) => setOptimize({ ...optimize, range_m: value })}
                />
              </div>
              <NumberInput
                label="Max cameras"
                value={optimize.max_cameras}
                onChange={(value) => setOptimize({ ...optimize, max_cameras: value })}
              />
              <button onClick={optimizePlacement} disabled={busy || !regionId}>
                Find Placements
              </button>
            </div>
          )}
        </section>

        {analysis && (
          <section className="metrics">
            <h2>Result</h2>
            <dl>
              <div>
                <dt>Cameras</dt>
                <dd>{analysis.cameras.features.length}</dd>
              </div>
              <div>
                <dt>Buildings</dt>
                <dd>{analysis.buildings.features.length}</dd>
              </div>
              <div>
                <dt>Wall gaps</dt>
                <dd>{analysis.wallBlindspots.features.length}</dd>
              </div>
              <div>
                <dt>Ground gaps</dt>
                <dd>{analysis.groundBlindspots.features.length}</dd>
              </div>
            </dl>
          </section>
        )}
      </aside>
      <section id="map" aria-label="Blindspot map" />
    </main>
  );
}

function NumberInput(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {props.label}
      <input type="number" step="any" value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const errorPayload = payload as { error?: string };
    throw new Error(errorPayload.error || "Request failed");
  }
  return payload as T;
}

function regionFeature(region: Region): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { id: region.id, name: region.name },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [region.west, region.south],
          [region.east, region.south],
          [region.east, region.north],
          [region.west, region.north],
          [region.west, region.south],
        ],
      ],
    },
  };
}

createRoot(document.getElementById("root")!).render(<App />);
