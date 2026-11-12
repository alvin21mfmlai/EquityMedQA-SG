// Local stand-in for Vercel: serves public/ and routes /api/NAME to api/NAME.js (same handler signature).
//   DATABASE_URL=postgres://... node dev/server.mjs   -> http://localhost:3000
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// the same response headers as production (vercel.json), so the Content-Security-Policy is exercised locally
const HEADERS = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"))
  .headers.flatMap((h) => h.headers.map(({ key, value }) => [key, value])));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z_-]/gi, "");
    const file = path.join(root, "api", `${name}.js`);
    if (name.startsWith("_") || !fs.existsSync(file)) return res.writeHead(404).end("not found");
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (!p || p.endsWith("/")) p += "index.html";
  const file = path.join(root, "public", p);
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
