FROM ubuntu:24.04

ARG BUN_VERSION=1.3.6
ENV DEBIAN_FRONTEND=noninteractive
ENV POSTGRES_DB=cam_blindspot
ENV POSTGRES_USER=cam_blindspot
ENV POSTGRES_PASSWORD=cam_blindspot

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    nodejs \
    npm \
    postgresql-16 \
    postgresql-16-postgis-3 \
    postgresql-16-postgis-3-scripts \
  && npm install -g "bun@${BUN_VERSION}" \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

RUN pg_dropcluster 16 main --stop 2>/dev/null; \
    mkdir -p /var/lib/postgresql/16/main && \
    chown -R postgres:postgres /var/lib/postgresql

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN cat > /usr/local/bin/docker-entrypoint.sh <<'SCRIPT'
#!/bin/bash
set -e

PGDATA=/var/lib/postgresql/16/main
PGBIN=/usr/lib/postgresql/16/bin

mkdir -p "$PGDATA" /var/run/postgresql
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  su - postgres -c "$PGBIN/initdb -D '$PGDATA'"
fi

if [ ! -f "$PGDATA/postgresql.conf" ]; then
  cat > "$PGDATA/postgresql.conf" <<EOF
data_directory = '$PGDATA'
hba_file = '$PGDATA/pg_hba.conf'
ident_file = '$PGDATA/pg_ident.conf'
listen_addresses = 'localhost'
port = 5432
unix_socket_directories = '/var/run/postgresql'
max_connections = 100
shared_buffers = 128MB
dynamic_shared_memory_type = posix
EOF
  chown postgres:postgres "$PGDATA/postgresql.conf"
fi

if [ ! -f "$PGDATA/pg_hba.conf" ]; then
  cat > "$PGDATA/pg_hba.conf" <<EOF
local   all             postgres                                peer
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
  chown postgres:postgres "$PGDATA/pg_hba.conf"
fi

touch "$PGDATA/pg_ident.conf"
chown postgres:postgres "$PGDATA/pg_ident.conf"

su - postgres -c "$PGBIN/pg_ctl -D '$PGDATA' -w start"
for i in $(seq 1 30); do
  if su - postgres -c "pg_isready -q" 2>/dev/null; then break; fi
  sleep 1
done

su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'\" | grep -q 1" 2>/dev/null ||
  su - postgres -c "psql -c \"CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'\" | grep -q 1" 2>/dev/null ||
  su - postgres -c "psql -c \"CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};\""
su - postgres -c "psql -d ${POSTGRES_DB} -tc \"SELECT 1 FROM pg_extension WHERE extname='postgis'\" | grep -q 1" 2>/dev/null ||
  su - postgres -c "psql -d ${POSTGRES_DB} -c \"CREATE EXTENSION postgis;\""

exec "$@"
SCRIPT

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "bun run seed && bun run start"]
