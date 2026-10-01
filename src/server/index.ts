import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGhTasks } from "./register.ts";

const iconSvg = await readFile(new URL("../assets/icon.svg", import.meta.url), "utf8");
const html = await readFile(new URL("./app.html", import.meta.url), "utf8");

const server = new McpServer({
  name: "gh-tasks",
  title: "GitHub Tasks",
  version: "0.1.7",
  icons: [{ src: "data:image/svg+xml," + encodeURIComponent(iconSvg), mimeType: "image/svg+xml" }],
});
registerGhTasks(server, html);
await server.connect(new StdioServerTransport());
