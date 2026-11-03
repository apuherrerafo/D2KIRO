import { extname, join, normalize } from "node:path";

const root = normalize(join(import.meta.dir, "..", "storybook-static"));
const port = Number(process.env.DESIGN_PORT ?? 6110);
const mimeTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

Bun.serve({
  fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" },
    });
  },
  hostname: "127.0.0.1",
  port,
});

console.log(`UX-0 static Storybook listening on http://127.0.0.1:${port}`);
