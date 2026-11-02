// A small static server for trying the page: http://localhost:8080 (the address that the
// daemon's [web] origins should list). Not for production.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const root = normalize(join(process.cwd(), "dist"));
createServer(async (req, res) => {
  const path = normalize(join(root, req.url === "/" ? "index.html" : (req.url ?? "").split("?")[0]));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(8080, "127.0.0.1", () => console.log("http://localhost:8080"));
