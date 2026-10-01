import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const { values } = parseArgs({ options: { "plugin-dir": { type: "string" } } });
const root = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.resolve(values["plugin-dir"] ?? root);
const out = path.join(pluginRoot, "dist");

/** Bundle the UI into one self-contained HTML document (MCP Apps iframes can't load external files). */
export async function buildAppHtml() {
  const js = await build({
    entryPoints: [path.join(root, "src/app/main.tsx")],
    bundle: true, minify: true, write: false, format: "iife", target: "es2022",
    jsx: "automatic", jsxImportSource: "preact", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const css = await readFile(path.join(root, "src/app/styles.css"), "utf8");
  const tpl = await readFile(path.join(root, "src/app/index.html"), "utf8");
  const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  return tpl
    .replace("<!-- APP_STYLE -->", () => css)
    .replace("<!-- APP_SCRIPT -->", () => `<script>${script}</script>`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await Promise.all([
    buildAppHtml().then((html) => writeFile(path.join(out, "app.html"), html)),
    build({
      entryPoints: [path.join(root, "src/server/index.ts")],
      bundle: true, format: "esm", platform: "node", target: "node22",
      outfile: path.join(out, "server.js"),
      // CJS deps bundled into ESM need require().
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ]);
  // dist/server.js resolves ../assets/icon.svg relative to itself.
  if (pluginRoot !== root) {
    await Promise.all([
      cp(path.join(root, ".codex-plugin"), path.join(pluginRoot, ".codex-plugin"), { recursive: true }),
      cp(path.join(root, "skills"), path.join(pluginRoot, "skills"), { recursive: true }),
      cp(path.join(root, "assets"), path.join(pluginRoot, "assets"), { recursive: true }),
      copyFile(path.join(root, ".mcp.json"), path.join(pluginRoot, ".mcp.json")),
      writeFile(path.join(pluginRoot, "package.json"), JSON.stringify({ private: true, type: "module", engines: { node: ">=22" } }, null, 2) + "\n"),
    ]);
  }
  console.log(`built → ${out}`);
}
