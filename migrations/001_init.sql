create extension if not exists postgis;

create table if not exists regions (
  id bigserial primary key,
  name text not null,
  north double precision not null,
  south double precision not null,
  east double precision not null,
  west double precision not null,
  bbox geometry(Polygon, 4326) not null,
  created_at timestamptz not null default now(),
  constraint regions_valid_bounds check (north > south and east > west)
);

create index if not exists regions_bbox_gix on regions using gist (bbox);

create table if not exists camera_sets (
  id bigserial primary key,
  region_id bigint not null references regions(id) on delete cascade,
  name text not null,
  source text not null check (source in ('db', 'csv', 'optimized')),
  created_at timestamptz not null default now()
);

create table if not exists cameras (
  id bigserial primary key,
  camera_set_id bigint not null references camera_sets(id) on delete cascade,
  camera text not null,
  lat double precision not null,
  long double precision not null,
  orientation_deg double precision not null,
  fov_deg double precision not null,
  range_m double precision not null,
  geom geometry(Point, 4326) not null
);

create index if not exists cameras_geom_gix on cameras using gist (geom);
create index if not exists cameras_camera_set_idx on cameras (camera_set_id);

create table if not exists buildings (
  id bigserial primary key,
  region_id bigint not null references regions(id) on delete cascade,
  source_osm_type text not null,
  source_osm_id text not null,
  tags jsonb not null default '{}'::jsonb,
  geom geometry(MultiPolygon, 4326) not null,
  imported_at timestamptz not null default now(),
  unique (region_id, source_osm_type, source_osm_id)
);

create index if not exists buildings_geom_gix on buildings using gist (geom);
create index if not exists buildings_region_idx on buildings (region_id);

create table if not exists analysis_runs (
  id bigserial primary key,
  camera_set_id bigint not null references camera_sets(id) on delete cascade,
  region_id bigint not null references regions(id) on delete cascade,
  ground_cell_size_m double precision not null,
  coverage_geojson jsonb not null,
  wall_normals_geojson jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists wall_blindspots (
  id bigserial primary key,
  analysis_run_id bigint not null references analysis_runs(id) on delete cascade,
  building_id bigint,
  length_m double precision not null,
  geom geometry(LineString, 4326) not null
);

create index if not exists wall_blindspots_geom_gix on wall_blindspots using gist (geom);
create index if not exists wall_blindspots_run_idx on wall_blindspots (analysis_run_id);

create table if not exists ground_blindspots (
  id bigserial primary key,
  analysis_run_id bigint not null references analysis_runs(id) on delete cascade,
  geom geometry(Polygon, 4326) not null
);

create index if not exists ground_blindspots_geom_gix on ground_blindspots using gist (geom);
create index if not exists ground_blindspots_run_idx on ground_blindspots (analysis_run_id);
