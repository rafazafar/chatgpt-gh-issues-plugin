import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type {
  OpenAIUiResourceMetadata,
  OpenAIUiToolMetadata,
} from "@openai/mcp-extensions/server";
import { z } from "zod/v4";
import * as h from "./handlers.ts";

const UI_URI = "ui://issue-launchpad/app-v1";

const readonly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

const ok = (data: object, text = "") => ({
  content: text ? [{ type: "text" as const, text }] : [],
  structuredContent: data as Record<string, unknown>,
});

/** Wrap a handler so GitHub failures reach the app as a readable tool error. */
function guard<A, R extends object>(fn: (a: A) => Promise<R>, summarise?: (r: R) => string) {
  return async (args: A) => {
    try {
      const r = await fn(args);
      return ok(r, summarise?.(r));
    } catch (e) {
      const err = h.errorOf(e);
      return {
        isError: true,
        content: [{ type: "text" as const, text: err.message }],
        structuredContent: { error: err } as Record<string, unknown>,
      };
    }
  };
}

const searchShape = {
  scope: z.enum(["involves", "assigned", "author", "mentions", "all"]).default("involves"),
  kind: z.enum(["issue", "pr", "any"]).default("issue"),
  state: z.enum(["open", "closed", "all"]).default("open"),
  repo: z.string().optional().describe("owner/name"),
  text: z.string().optional().describe("Free text and/or raw GitHub search qualifiers"),
  labels: z.array(z.string()).optional(),
  sort: z.enum(["updated", "created", "comments"]).default("updated"),
  after: z.string().nullish().describe("Pagination cursor from a previous result"),
};

// Sidebar icon: the SDK's registerTool has no per-tool `icons`, so entrypoints use the
// server icon set in index.ts (spec fallback #2).
export function registerLaunchpad(server: McpServer, html: string) {
  registerAppResource(server, "Issue Launchpad", UI_URI, {}, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          // Avatars are inlined server-side; this also allows GitHub's image host if the host honours CSP.
          ui: { csp: { resourceDomains: ["https://avatars.githubusercontent.com"] } },
          "openai/ui": {
            preferredDisplayMode: "fullscreen",
            availableDisplayModes: ["inline", "fullscreen"],
          } satisfies OpenAIUiResourceMetadata,
        },
      },
    ],
  }));

  const ui = (entrypoints: OpenAIUiToolMetadata["entrypoints"], visibility?: ("app" | "model")[]) => ({
    ui: { resourceUri: UI_URI, ...(visibility ? { visibility } : {}) },
    "openai/ui": { entrypoints } satisfies OpenAIUiToolMetadata,
    "openai/iconStyle": "monochrome",
  });

  // Sidebar entrypoint: fullscreen board, args are always {}.
  registerAppTool(
    server,
    "launchpad.open",
    {
      title: "Issue Launchpad",
      description: "Open the Issue Launchpad: browse GitHub issues and Projects and start tasks.",
      inputSchema: {},
      annotations: readonly,
      _meta: ui([{ type: "global" }]),
    },
    async () => ok(await h.open()),
  );

  // Thread entrypoint: the same app as a tab beside the conversation.
  registerAppTool(
    server,
    "launchpad.tray",
    {
      title: "Issue Launchpad",
      description: "Open Issue Launchpad beside this conversation.",
      inputSchema: {},
      annotations: readonly,
      _meta: ui([{ type: "thread" }]),
    },
    async () => ok(await h.open()),
  );

  registerAppTool(
    server,
    "launchpad.search",
    {
      title: "Search GitHub issues",
      description:
        "Search issues or pull requests on the connected GitHub account. Supports GitHub search qualifiers in `text` (e.g. `label:bug no:assignee`).",
      inputSchema: searchShape,
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(
      (a) => h.search(a as never),
      (r) =>
        `${r.totalCount} results.\n` +
        r.items.map((i) => `- ${i.repo}#${i.number} [${i.state}] ${i.title}`).join("\n"),
    ),
  );

  registerAppTool(
    server,
    "launchpad.projects",
    {
      title: "List GitHub Projects",
      description: "List GitHub Projects (v2) visible to the connected account.",
      inputSchema: {},
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(h.projects, (r) => r.projects.map((p) => `- ${p.owner}/${p.number} ${p.title} (${p.itemCount} items)`).join("\n")),
  );

  registerAppTool(
    server,
    "launchpad.board",
    {
      title: "Read a GitHub Project board",
      description: "Read every item of a GitHub Project (v2) with its field values, by project node id.",
      inputSchema: { projectId: z.string() },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    guard(({ projectId }: { projectId: string }) => h.board(projectId)),
  );

  registerAppTool(
    server,
    "launchpad.issue",
    {
      title: "Read a GitHub issue",
      description:
        "Read the full body, labels, linked pull requests and recent comments of an issue or pull request.",
      inputSchema: { repo: z.string().describe("owner/name"), number: z.number().int() },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(
      ({ repo, number }: { repo: string; number: number }) => h.issue(repo, number),
      (d) =>
        `# ${d.repo}#${d.number}: ${d.title}\nState: ${d.state}\nLabels: ${d.labels.map((l) => l.name).join(", ") || "none"}\nURL: ${d.url}\n\n${d.body}\n\n` +
        d.recentComments.map((c) => `--- ${c.author} (${c.createdAt})\n${c.body}`).join("\n\n"),
    ),
  );
}
