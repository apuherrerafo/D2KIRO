import { getHealthStatus } from "./health";

const PORT = Number(process.env.ENGINE_PORT ?? 4000);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return Response.json(getHealthStatus(0));
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`apps/engine escuchando en http://${server.hostname}:${server.port}`);
