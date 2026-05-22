FROM ubuntu:24.04

ARG BUN_VERSION=1.3.6
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates nodejs npm \
  && npm install -g "bun@${BUN_VERSION}" \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "bun run seed && bun run start"]
