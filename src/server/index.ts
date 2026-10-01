import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerLaunchpad } from "./register.ts";

const iconSvg = await readFile(new URL("../assets/icon.svg", import.meta.url), "utf8");
const html = await readFile(new URL("./app.html", import.meta.url), "utf8");

const server = new McpServer({
  name: "issue-launchpad",
  title: "Issue Launchpad",
  version: "0.1.2",
  icons: [{ src: "data:image/svg+xml," + encodeURIComponent(iconSvg), mimeType: "image/svg+xml" }],
});
registerLaunchpad(server, html);
await server.connect(new StdioServerTransport());
