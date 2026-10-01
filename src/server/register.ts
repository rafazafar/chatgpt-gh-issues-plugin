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

const UI_URI = "ui://gh-tasks/app-v1";

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

const hostField = z.string().optional().describe("GitHub host, e.g. github.com or ghe.corp.com. Defaults to the signed-in default.");

const userField = z.string().optional().describe("Signed-in account (login) on that host. Defaults to the GitHub CLI's active account.");

const searchShape = {
  host: hostField,
  user: userField,
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
export function registerGhTasks(server: McpServer, html: string) {
  registerAppResource(server, "GitHub Tasks", UI_URI, {}, async () => ({
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
    "gh_tasks.open",
    {
      title: "GitHub Tasks",
      description: "Open GitHub Tasks: browse GitHub issues and Projects and start tasks.",
      inputSchema: {},
      annotations: readonly,
      _meta: ui([{ type: "global" }]),
    },
    async () => ok(await h.open()),
  );

  // Thread entrypoint: the same app as a tab beside the conversation.
  registerAppTool(
    server,
    "gh_tasks.tray",
    {
      title: "GitHub Tasks",
      description: "Open GitHub Tasks beside this conversation.",
      inputSchema: {},
      annotations: readonly,
      _meta: ui([{ type: "thread" }]),
    },
    async () => ok(await h.open()),
  );

  registerAppTool(
    server,
    "gh_tasks.hosts",
    {
      title: "GitHub hosts",
      description: "GitHub instances (github.com, GitHub Enterprise) this machine is signed in to.",
      inputSchema: {},
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(h.hosts, (r) => `Hosts: ${r.hosts.join(", ")} (default: ${r.default}). Accounts: ${r.accounts.map((a) => `${a.login}@${a.host}${a.active ? "*" : ""}`).join(", ") || "none listed"}`),
  );

  registerAppTool(
    server,
    "gh_tasks.checkHost",
    {
      title: "Check a GitHub host",
      description: "Check whether a GitHub host is reachable and signed in, and what to do if not.",
      inputSchema: { host: z.string(), user: userField },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    guard(({ host, user }: { host: string; user?: string }) => h.checkHost(host, user)),
  );

  registerAppTool(
    server,
    "gh_tasks.suggestHosts",
    {
      title: "Suggest GitHub hosts",
      description: "Hostnames found in the user's SSH config (names only), offered as suggestions when connecting a host.",
      inputSchema: {},
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    guard(h.suggestHosts),
  );

  registerAppTool(
    server,
    "gh_tasks.viewer",
    {
      title: "Current GitHub user",
      description: "The GitHub account GitHub Tasks is signed in as.",
      inputSchema: { host: hostField, user: userField },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    guard(({ host, user }: { host?: string; user?: string }) => h.viewer(host, user)),
  );

  registerAppTool(
    server,
    "gh_tasks.search",
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
    "gh_tasks.projects",
    {
      title: "List GitHub Projects",
      description: "List GitHub Projects (v2) visible to the connected account.",
      inputSchema: { host: hostField, user: userField },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(({ host, user }: { host?: string; user?: string }) => h.projects(host, user), (r) => r.projects.map((p) => `- ${p.owner}/${p.number} ${p.title} (${p.itemCount} items)`).join("\n")),
  );

  registerAppTool(
    server,
    "gh_tasks.board",
    {
      title: "Read a GitHub Project board",
      description: "Read every item of a GitHub Project (v2) with its field values, by project node id.",
      inputSchema: { projectId: z.string(), host: hostField, user: userField },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    guard(({ projectId, host, user }: { projectId: string; host?: string; user?: string }) => h.board(projectId, host, user)),
  );

  registerAppTool(
    server,
    "gh_tasks.issue",
    {
      title: "Read a GitHub issue",
      description:
        "Read the full body, labels, linked pull requests and recent comments of an issue or pull request.",
      inputSchema: { repo: z.string().describe("owner/name"), number: z.number().int(), host: hostField, user: userField },
      annotations: readonly,
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app", "model"] } },
    },
    guard(
      ({ repo, number, host, user }: { repo: string; number: number; host?: string; user?: string }) => h.issue(repo, number, host, user),
      (d) =>
        `# ${d.repo}#${d.number}: ${d.title}\nState: ${d.state}\nLabels: ${d.labels.map((l) => l.name).join(", ") || "none"}\nURL: ${d.url}\n\n${d.body}\n\n` +
        d.recentComments.map((c) => `--- ${c.author} (${c.createdAt})\n${c.body}`).join("\n\n"),
    ),
  );
}
