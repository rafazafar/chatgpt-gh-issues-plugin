// Standalone preview: serves the real app bundle in a normal browser tab and backs
// it with the real tool handlers over HTTP. Use it to iterate on UI without Codex.
import { createServer } from "node:http";
import { buildAppHtml } from "./build.mjs";
import * as real from "../src/server/handlers.ts";
import * as demo from "../src/server/demo.ts";

// DEMO=1 serves fake data (used for README screenshots) instead of calling GitHub.
const h = process.env.DEMO ? { ...demo, errorOf: real.errorOf } : real;

const port = Number(process.env.PORT ?? 5199);
const tools = {
  "launchpad.open": () => h.open(),
  "launchpad.hosts": () => h.hosts(),
  "launchpad.viewer": (a) => h.viewer(a.host),
  "launchpad.search": (a) => h.search(a),
  "launchpad.projects": (a) => h.projects(a.host),
  "launchpad.board": (a) => h.board(a.projectId, a.host),
  "launchpad.issue": (a) => h.issue(a.repo, a.number, a.host),
};

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await buildAppHtml());
    }
    const name = req.url?.startsWith("/api/") ? decodeURIComponent(req.url.slice(5)) : null;
    if (req.method === "POST" && name && tools[name]) {
      let body = "";
      for await (const c of req) body += c;
      const out = await tools[name](body ? JSON.parse(body) : {});
      // LATENCY=3000 npm run dev simulates a slow GitHub, to exercise loading states.
      if (process.env.LATENCY) await new Promise((r) => setTimeout(r, Number(process.env.LATENCY)));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    const err = h.errorOf(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err }));
  }
}).listen(port, () => console.log(`Issue Launchpad preview → http://localhost:${port}`));
