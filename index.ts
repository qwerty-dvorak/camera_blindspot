import index from "./index.html";
import { handleApiRequest } from "./src/server/api";
import { migrate } from "./src/server/migrate";

if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
  await migrate();
}

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  routes: {
    "/": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(req, url);
    }
    if (url.pathname.startsWith("/cesium/")) {
      const filePath = url.pathname.replace("/cesium/", "");
      const file = Bun.file(`node_modules/cesium/Build/Cesium/${filePath}`);
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  },
  development: {
    hmr: process.env.NODE_ENV !== "production",
    console: process.env.NODE_ENV !== "production",
  },
});

console.log(`cam_blindspot listening on http://localhost:${server.port}`);
