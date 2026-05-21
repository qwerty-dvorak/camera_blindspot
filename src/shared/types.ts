export type BoundsInput = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type CameraInput = {
  camera: string;
  lat: number;
  long: number;
  orientation_deg: number;
  fov_deg: number;
  range_m: number;
};

export type Region = BoundsInput & {
  id: number;
  name: string;
  created_at: string;
};

export type CameraScenario = {
  id: number;
  region_id: number;
  name: string;
  source: "db" | "csv" | "optimized";
  created_at: string;
  camera_count?: number;
};

export type AnalysisLayerResponse = {
  analysis: {
    id: number;
    scenario_id: number;
    created_at: string;
    ground_cell_size_m: number;
  };
  region: Region;
  scenario: CameraScenario;
  buildings: GeoJSON.FeatureCollection;
  cameras: GeoJSON.FeatureCollection;
  coverage: GeoJSON.FeatureCollection;
  wallNormals: GeoJSON.FeatureCollection;
  wallBlindspots: GeoJSON.FeatureCollection;
  groundBlindspots: GeoJSON.FeatureCollection;
};
