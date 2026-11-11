// Misma función que `serve-static.ts`, en Node puro: lo usa el VRT de Linux dentro de la imagen oficial de Playwright (no trae Bun).
// Solo sirve `storybook-static/` en 127.0.0.1; ninguna otra ruta.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), "..", "storybook-static"));
const port = Number(process.env.DESIGN_PORT ?? 6110);
const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1");
