const defaultBounds = { north: 28.6165, south: 28.6128, east: 77.232, west: 77.226 };
const state = { regions: [], scenarios: [], regionId: null, scenarioId: null, busy: false, analysis: null };
const $ = (id) => document.getElementById(id);

const styles = {
  region: {
    material: Cesium.Color.fromCssColorString("#263238").withAlpha(0),
    outlineColor: Cesium.Color.fromCssColorString("#263238"),
    outlineWidth: 2,
  },
  building: { fill: Cesium.Color.fromCssColorString("#8d6e63").withAlpha(0.45), stroke: Cesium.Color.fromCssColorString("#5d4037"), strokeWidth: 1 },
  coverage: { fill: Cesium.Color.fromCssColorString("#42a5f5").withAlpha(0.22), stroke: Cesium.Color.fromCssColorString("#1976d2"), strokeWidth: 1 },
  groundBlindspot: { fill: Cesium.Color.fromCssColorString("#ef5350").withAlpha(0.35), stroke: Cesium.Color.fromCssColorString("#d32f2f"), strokeWidth: 0.5 },
  wallBlindspot: { stroke: Cesium.Color.fromCssColorString("#b71c1c"), strokeWidth: 4 },
  wallNormal: { stroke: Cesium.Color.fromCssColorString("#00897b"), strokeWidth: 1 },
};

let viewer;

document.addEventListener("DOMContentLoaded", () => {
  viewer = new Cesium.Viewer("cesiumContainer", {
    sceneMode: Cesium.SceneMode.SCENE3D,
    scene3DOnly: true,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    homeButton: false,
    navigationHelpButton: false,
    geocoder: false,
    baseLayerPicker: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: window.TILE_SERVER_URL })),
  });
  configureMapControls(viewer);
  initializeForm();
  bindEvents();
  void loadRegions();
});

function configureMapControls(viewerInstance) {
  const controller = viewerInstance.scene.screenSpaceCameraController;
  controller.enableLook = false;
  controller.enableTilt = false;
  controller.inertiaSpin = 0;
  controller.inertiaTranslate = 0;
  controller.inertiaZoom = 0;
}

function initializeForm() {
  $("north").value = defaultBounds.north;
  $("south").value = defaultBounds.south;
  $("east").value = defaultBounds.east;
  $("west").value = defaultBounds.west;
  $("regionName").value = "Demo region";
  $("csvName").value = "CSV camera set";
  $("csvText").value = "camera,lat,long,orientation_deg,fov_deg,range_m\nCAM-1,28.6146,77.2288,70,75,90";
  $("fovDeg").value = 80;
  $("rangeM").value = 90;
  $("maxCameras").value = 24;
}

function bindEvents() {
  $("regionSelect").addEventListener("change", (event) => {
    const region = state.regions.find((item) => item.id === Number(event.target.value));
    if (region) applyRegionDefaults(region);
  });
  $("createRegion").addEventListener("click", createRegion);
  $("importBuildings").addEventListener("click", importBuildings);
  $("scenarioSelect").addEventListener("change", (event) => {
    state.scenarioId = Number(event.target.value) || null;
  });
  $("analyzeSaved").addEventListener("click", analyzeSaved);
  $("uploadCsv").addEventListener("click", uploadCsv);
  $("optimizePlacement").addEventListener("click", optimizePlacement);
  document.querySelectorAll("[data-workflow]").forEach((button) => {
    button.addEventListener("click", () => setWorkflow(button.dataset.workflow));
  });
}

async function loadRegions() {
  const data = await api("/api/regions");
  state.regions = data;
  renderRegionOptions();
  if (data[0]) applyRegionDefaults(data[0]);
}

async function loadScenarios(regionId) {
  const data = await api(`/api/regions/${regionId}/scenarios`);
  state.scenarios = data;
  state.scenarioId = data[0]?.id ?? null;
  renderScenarioOptions();
}

function renderRegionOptions() {
  $("regionSelect").innerHTML = '<option value="">None</option>';
  for (const region of state.regions) $("regionSelect").append(new Option(region.name, region.id));
}

function renderScenarioOptions() {
  $("scenarioSelect").innerHTML = '<option value="">None</option>';
  for (const scenario of state.scenarios) $("scenarioSelect").append(new Option(`${scenario.name} (${scenario.camera_count ?? 0})`, scenario.id));
  $("scenarioSelect").value = state.scenarioId ?? "";
}

function applyRegionDefaults(region) {
  state.regionId = region.id;
  $("regionSelect").value = region.id;
  $("north").value = region.north;
  $("south").value = region.south;
  $("east").value = region.east;
  $("west").value = region.west;
  $("regionName").value = region.name;
  setTopDownRegionView(viewer, region);
  void loadScenarios(region.id);
}

async function createRegion() {
  await runTask("Creating region", async () => {
    const region = await api("/api/regions", {
      method: "POST",
      body: JSON.stringify({
        name: $("regionName").value,
        north: Number($("north").value),
        south: Number($("south").value),
        east: Number($("east").value),
        west: Number($("west").value),
      }),
    });
    state.regions = [region, ...state.regions.filter((item) => item.id !== region.id)];
    renderRegionOptions();
    applyRegionDefaults(region);
    setStatus("Region created");
  });
}

async function importBuildings() {
  if (!state.regionId) return;
  await runTask("Importing buildings from OpenStreetMap", async () => {
    const response = await api(`/api/regions/${state.regionId}/import-buildings`, { method: "POST" });
    setStatus(`Imported ${response.imported} building footprint(s)`);
  });
}

async function uploadCsv() {
  if (!state.regionId) return;
  await runTask("Uploading CSV camera set", async () => {
    const scenario = await api(`/api/regions/${state.regionId}/scenarios/upload-csv?name=${encodeURIComponent($("csvName").value)}`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: $("csvText").value,
    });
    state.scenarioId = scenario.id;
    await loadScenarios(state.regionId);
    renderAnalysis(await api(`/api/scenarios/${scenario.id}/analyze`, { method: "POST" }));
    setStatus("CSV scenario analyzed");
  });
}

async function analyzeSaved() {
  if (!state.scenarioId) return;
  await runTask("Running blindspot analysis", async () => {
    renderAnalysis(await api(`/api/scenarios/${state.scenarioId}/analyze`, { method: "POST" }));
    setStatus("Scenario analyzed");
  });
}

async function optimizePlacement() {
  if (!state.regionId) return;
  await runTask("Optimizing camera placement", async () => {
    const result = await api(`/api/regions/${state.regionId}/optimize`, {
      method: "POST",
      body: JSON.stringify({
        fov_deg: Number($("fovDeg").value),
        range_m: Number($("rangeM").value),
        max_cameras: Number($("maxCameras").value),
      }),
    });
    state.scenarioId = result.scenario.id;
    await loadScenarios(state.regionId);
    renderAnalysis(result);
    setStatus(`Optimized ${result.cameras.features.length} camera placement(s)`);
  });
}

async function runTask(label, task) {
  setBusy(true);
  setStatus(label);
  try {
    await task();
  } catch (error) {
    setStatus(error.message || "Unexpected error");
  } finally {
    setBusy(false);
  }
}

function renderAnalysis(result) {
  state.analysis = result;
  viewer.dataSources.removeAll();
  viewer.entities.removeAll();
  viewer.entities.add({
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        result.region.west, result.region.south,
        result.region.east, result.region.south,
        result.region.east, result.region.north,
        result.region.west, result.region.north,
      ]),
      material: styles.region.material,
      outline: true,
      outlineColor: styles.region.outlineColor,
      outlineWidth: styles.region.outlineWidth,
    },
  });
  addGeoJsonLayer("buildings", result.buildings, styles.building);
  addGeoJsonLayer("coverage", result.coverage, styles.coverage);
  addGeoJsonLayer("groundBlindspots", result.groundBlindspots, styles.groundBlindspot);
  addGeoJsonLayer("wallBlindspots", result.wallBlindspots, styles.wallBlindspot);
  addGeoJsonLayer("wallNormals", result.wallNormals, styles.wallNormal);
  for (const feature of result.cameras.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties ?? {};
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: {
        image: createCameraIcon(Number(props.orientation_deg ?? 0)),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
      description: `<strong>${props.camera ?? "Camera"}</strong><br>FOV ${props.fov_deg} deg<br>Range ${props.range_m} m`,
    });
  }
  setTopDownRegionView(viewer, result.region);
  $("metrics").classList.remove("hidden");
  $("metricCameras").textContent = result.cameras.features.length;
  $("metricBuildings").textContent = result.buildings.features.length;
  $("metricWallGaps").textContent = result.wallBlindspots.features.length;
  $("metricGroundGaps").textContent = result.groundBlindspots.features.length;
}

function addGeoJsonLayer(name, geoJson, style) {
  if (!geoJson.features.length) return;
  const dataSource = new Cesium.GeoJsonDataSource(name);
  void dataSource.load(geoJson, style);
  viewer.dataSources.add(dataSource);
}

function setTopDownRegionView(viewerInstance, bounds) {
  const centerLon = (bounds.east + bounds.west) / 2;
  const centerLat = (bounds.north + bounds.south) / 2;
  const { widthMeters, heightMeters } = regionSizeMeters(bounds);
  const largestSideMeters = Math.max(widthMeters, heightMeters, 1000);
  const canvasAspect = Math.max(viewerInstance.canvas.clientWidth, 1) / Math.max(viewerInstance.canvas.clientHeight, 1);
  const frustumWidthMeters = Math.max(widthMeters, heightMeters * canvasAspect, 1000) * 1.2;
  viewerInstance.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, largestSideMeters * 2),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
  });
  viewerInstance.camera.switchToOrthographicFrustum();
  if ("width" in viewerInstance.camera.frustum) viewerInstance.camera.frustum.width = frustumWidthMeters;
}

function regionSizeMeters(bounds) {
  const centerLatRadians = Cesium.Math.toRadians((bounds.north + bounds.south) / 2);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.max(Math.cos(centerLatRadians), 0.01);
  return {
    widthMeters: Math.abs(bounds.east - bounds.west) * metersPerDegreeLon,
    heightMeters: Math.abs(bounds.north - bounds.south) * metersPerDegreeLat,
  };
}

function createCameraIcon(orientationDeg) {
  const size = 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#ffc107";
  ctx.fill();
  ctx.strokeStyle = "#102027";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((orientationDeg + 180) * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(-5, -5);
  ctx.lineTo(5, -5);
  ctx.closePath();
  ctx.fillStyle = "#102027";
  ctx.fill();
  ctx.restore();
  return canvas;
}

function setWorkflow(workflow) {
  document.querySelectorAll("[data-workflow]").forEach((button) => button.classList.toggle("active", button.dataset.workflow === workflow));
  $("savedWorkflow").classList.toggle("hidden", workflow !== "saved");
  $("csvWorkflow").classList.toggle("hidden", workflow !== "csv");
  $("optimizeWorkflow").classList.toggle("hidden", workflow !== "optimize");
}

function setStatus(message) {
  $("status").textContent = message;
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button").forEach((button) => (button.disabled = busy));
}

async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}
