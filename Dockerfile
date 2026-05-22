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

RUN mkdir -p /var/lib/postgresql/16/main && \
    chown -R postgres:postgres /var/lib/postgresql

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN cat > /usr/local/bin/docker-entrypoint.sh <<'SCRIPT'
#!/bin/bash
set -e

if [ ! -f /var/lib/postgresql/16/main/PG_VERSION ]; then
  pg_createcluster 16 main
  pg_ctlcluster 16 main start
  for i in $(seq 1 30); do
    if su - postgres -c "pg_isready -q" 2>/dev/null; then break; fi
    sleep 1
  done
  su - postgres -c "psql -c \"CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';\""
  su - postgres -c "psql -c \"CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};\""
  su - postgres -c "psql -d ${POSTGRES_DB} -c \"CREATE EXTENSION IF NOT EXISTS postgis;\""
  pg_ctlcluster 16 main stop
fi

pg_ctlcluster 16 main start
exec "$@"
SCRIPT

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "bun run seed && bun run start"]
