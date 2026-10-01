import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  Board,
  BoardField,
  HostsInfo,
  IssueDetail,
  Item,
  Page,
  ProjectSummary,
  SearchParams,
  Viewer,
} from "../shared/types.ts";

const run = promisify(execFile);

export type ErrorCode = "no_token" | "bad_token" | "network" | "unknown";

export class GitHubError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------- auth

// ---------------------------------------------------------------- hosts

export const DEFAULT_HOST = "github.com";

/** "https://GHE.Corp.com/" → "ghe.corp.com"; empty → github.com. */
export function normalizeHost(h?: string | null): string {
  const v = (h ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  return v || DEFAULT_HOST;
}

/**
 * GraphQL endpoint per flavour of GitHub:
 *   github.com            → https://api.github.com/graphql
 *   *.ghe.com (data res.) → https://api.<host>/graphql
 *   GitHub Enterprise Server → https://<host>/api/graphql
 */
export function graphqlUrl(host: string): string {
  if (host === DEFAULT_HOST) return "https://api.github.com/graphql";
  if (host.endsWith(".ghe.com")) return `https://api.${host}/graphql`;
  return `https://${host}/api/graphql`;
}

/** Hostnames are the unindented top-level keys of gh's hosts.yml. */
export function parseHostsYml(text: string): string[] {
  return [...text.matchAll(/^([A-Za-z0-9][A-Za-z0-9.-]*):\s*$/gm)].map((m) => normalizeHost(m[1]));
}

function ghConfigDirs(): string[] {
  const e = process.env;
  const home = e.HOME ?? e.USERPROFILE ?? "";
  return [
    e.GH_CONFIG_DIR,
    e.XDG_CONFIG_HOME && `${e.XDG_CONFIG_HOME}/gh`,
    home && `${home}/.config/gh`,
    e.APPDATA && `${e.APPDATA}/GitHub CLI`,
  ].filter(Boolean) as string[];
}

/** Which GitHub instances this machine is signed in to, and which one to start on. */
export async function listHosts(): Promise<HostsInfo> {
  const found = new Set<string>();
  for (const dir of ghConfigDirs()) {
    try {
      parseHostsYml(await readFile(`${dir}/hosts.yml`, "utf8")).forEach((h) => found.add(h));
      break;
    } catch {
      /* try the next location */
    }
  }
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) found.add(DEFAULT_HOST);
  if (process.env.GH_ENTERPRISE_TOKEN || process.env.GITHUB_ENTERPRISE_TOKEN) found.add(normalizeHost(process.env.GH_HOST));
  if (process.env.GH_HOST) found.add(normalizeHost(process.env.GH_HOST));
  const hosts = [...found];
  if (!hosts.length) hosts.push(DEFAULT_HOST);
  // Same rule as the gh CLI: GH_HOST wins; otherwise github.com if signed in, else the first host.
  const preferred = process.env.GH_HOST ? normalizeHost(process.env.GH_HOST) : undefined;
  return { hosts, default: preferred && hosts.includes(preferred) ? preferred : hosts.includes(DEFAULT_HOST) ? DEFAULT_HOST : hosts[0] };
}

// ---------------------------------------------------------------- auth

const tokenCache = new Map<string, { value: string; at: number }>();

/**
 * Desktop apps often start the plugin with a minimal PATH (no Homebrew), so `gh` is also
 * looked up in the usual install locations rather than only by name.
 */
export function ghCandidates(): string[] {
  const home = process.env.HOME ?? "";
  return [
    "gh",
    "/opt/homebrew/bin/gh", // macOS, Apple silicon
    "/usr/local/bin/gh", // macOS Intel / Linux
    "/usr/bin/gh",
    "/home/linuxbrew/.linuxbrew/bin/gh",
    ...(home ? [`${home}/.local/bin/gh`] : []),
  ];
}

/**
 * Resolve a token for one host without ever asking the user to paste one: environment variables
 * first (the same ones gh honours), then the GitHub CLI session for that exact host.
 */
export async function getToken(hostArg?: string): Promise<string> {
  const host = normalizeHost(hostArg);
  const env =
    host === DEFAULT_HOST
      ? (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)
      : (process.env.GH_ENTERPRISE_TOKEN ?? process.env.GITHUB_ENTERPRISE_TOKEN);
  if (env) return env;
  const cached = tokenCache.get(host);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  let installed = false;
  for (const bin of ghCandidates()) {
    try {
      const { stdout } = await run(bin, ["auth", "token", "--hostname", host], { timeout: 10_000 });
      const value = stdout.trim();
      if (value) {
        tokenCache.set(host, { value, at: Date.now() });
        return value;
      }
      installed = true; // gh exists but has no login for this host
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        installed = true; // gh ran and failed (not logged in to this host)
        break;
      }
    }
  }
  const login = host === DEFAULT_HOST ? "gh auth login" : `gh auth login --hostname ${host}`;
  const envName = host === DEFAULT_HOST ? "GITHUB_TOKEN" : "GH_ENTERPRISE_TOKEN";
  throw new GitHubError(
    "no_token",
    installed
      ? `The GitHub CLI isn't logged in to ${host}. Run \`${login}\` (then \`gh auth refresh -s project --hostname ${host}\` for Projects), or set ${envName}.`
      : `No credentials found for ${host}. Install the GitHub CLI (https://cli.github.com) and run \`${login}\`, or set ${envName} for the app.`,
  );
}

type GqlResponse<T> = {
  data?: T;
  errors?: { message: string; type?: string; path?: unknown[] }[];
};

async function gql<T>(
  host: string,
  query: string,
  variables: Record<string, unknown> = {},
  { tolerant = false }: { tolerant?: boolean } = {},
): Promise<{ data: T; warnings: string[] }> {
  const token = await getToken(host);
  let res: Response;
  try {
    res = await fetch(graphqlUrl(host), {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "codex-issue-launchpad",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new GitHubError("network", `Could not reach ${host}: ${(e as Error).message}`);
  }
  if (res.status === 401) {
    tokenCache.delete(host);
    throw new GitHubError("bad_token", `${host} rejected the token (401). Re-run \`gh auth login${host === DEFAULT_HOST ? "" : " --hostname " + host}\`.`);
  }
  if (!res.ok) throw new GitHubError("unknown", `${host} returned ${res.status}.`);
  const json = (await res.json()) as GqlResponse<T>;
  const warnings = (json.errors ?? []).map((e) => e.message);
  if (!json.data || (!tolerant && warnings.length))
    throw new GitHubError("unknown", warnings.join("; ") || "Empty response from GitHub.");
  return { data: json.data, warnings };
}

// ------------------------------------------------------------ fragments

const ITEM_FIELDS = `
  id number title url state createdAt updatedAt bodyText
  repository { nameWithOwner }
  author { login }
  labels(first: 8) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl(size: 48) } }
  comments { totalCount }
  milestone { title }
`;

const ISSUE_FIELDS = `${ITEM_FIELDS}
  projectItems(first: 4) {
    nodes {
      project { title number }
      status: fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue { name }
      }
    }
  }
`;

const PR_FIELDS = `
  id number title url state isDraft createdAt updatedAt bodyText
  repository { nameWithOwner }
  author { login }
  labels(first: 8) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl(size: 48) } }
  comments { totalCount }
  milestone { title }
`;

// ------------------------------------------------------------ normalise

/* eslint-disable @typescript-eslint/no-explicit-any */
function excerpt(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function toItem(n: any): Item | null {
  if (!n || !n.__typename) return null;
  const kind = n.__typename === "PullRequest" ? "pr" : n.__typename === "DraftIssue" ? "draft" : "issue";
  const state =
    kind === "draft"
      ? "DRAFT"
      : kind === "pr" && n.isDraft
        ? "DRAFT"
        : (n.state as Item["state"]);
  return {
    id: n.id,
    kind,
    number: n.number ?? null,
    title: n.title ?? "(untitled)",
    url: n.url ?? null,
    state,
    repo: n.repository?.nameWithOwner ?? null,
    author: n.author?.login ?? null,
    labels: (n.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })),
    assignees: (n.assignees?.nodes ?? []).map((a: any) => ({ login: a.login, avatarUrl: a.avatarUrl })),
    comments: n.comments?.totalCount ?? 0,
    milestone: n.milestone?.title ?? null,
    createdAt: n.createdAt ?? null,
    updatedAt: n.updatedAt ?? null,
    excerpt: excerpt(n.bodyText),
    projects: (n.projectItems?.nodes ?? [])
      .filter((p: any) => p?.project)
      .map((p: any) => ({
        title: p.project.title,
        number: p.project.number,
        status: p.status?.name ?? null,
      })),
    fields: {},
  };
}


// ------------------------------------------------------------- avatars

const avatarCache = new Map<string, Promise<string>>();

/**
 * MCP App iframes run under a strict CSP that may block remote images, so avatars are
 * fetched here and inlined as small data URIs. Failures fall back to the original URL.
 */
function inlineAvatar(url: string, host = DEFAULT_HOST): Promise<string> {
  if (!url || url.startsWith("data:")) return Promise.resolve(url);
  let p = avatarCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        // Avatars served by an Enterprise host itself can require the same credentials as the API.
        const sameHost = host !== DEFAULT_HOST && new URL(url).hostname.endsWith(host.replace(/^api\./, ""));
        const headers: Record<string, string> = sameHost ? { authorization: `bearer ${await getToken(host)}` } : {};
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
        if (!res.ok) return url;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 40_000) return url;
        return `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
      } catch {
        return url;
      }
    })();
    avatarCache.set(url, p);
  }
  return p;
}

async function withAvatars(items: Item[], host = DEFAULT_HOST): Promise<Item[]> {
  await Promise.all(
    items.flatMap((i) =>
      i.assignees.map(async (a) => {
        a.avatarUrl = await inlineAvatar(a.avatarUrl, host);
      }),
    ),
  );
  return items;
}


// ------------------------------------------------------- older-server tolerance

/**
 * Some optional fields (project membership, linked PRs) don't exist on older GitHub Enterprise
 * Server releases, and one unknown field fails the entire query. Retry once without them.
 */
const OPTIONAL_FIELDS = /projectItems|ProjectV2|fieldValueByName|closedByPullRequestsReferences/;

async function withoutOptionalFields<T>(run: (lean: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (e) {
    if (e instanceof GitHubError && e.code === "unknown" && OPTIONAL_FIELDS.test(e.message)) return run(true);
    throw e;
  }
}

// --------------------------------------------------------------- viewer

export async function getViewer(hostArg?: string): Promise<Viewer> {
  const host = normalizeHost(hostArg);
  const { data } = await gql<any>(
    host,
    `{ viewer { login name avatarUrl(size: 64) organizations(first: 50) { nodes { login } } } }`,
    {},
    { tolerant: true },
  );
  return {
    login: data.viewer.login,
    name: data.viewer.name ?? null,
    avatarUrl: await inlineAvatar(data.viewer.avatarUrl, host),
    orgs: data.viewer.organizations.nodes.map((o: any) => o.login),
  };
}

// --------------------------------------------------------------- search

export function buildSearchQuery(p: SearchParams): string {
  const q: string[] = [];
  if (p.kind === "issue") q.push("is:issue");
  else if (p.kind === "pr") q.push("is:pr");
  if (p.state !== "all") q.push(`is:${p.state}`);
  q.push("archived:false");
  if (p.repo) q.push(`repo:${p.repo}`);
  else if (p.scope === "involves") q.push("involves:@me");
  else if (p.scope === "assigned") q.push("assignee:@me");
  else if (p.scope === "author") q.push("author:@me");
  else if (p.scope === "mentions") q.push("mentions:@me");
  // "all" with no repo is only meaningful when the user types qualifiers; fall back to involves
  else if (!p.text) q.push("involves:@me");
  for (const l of p.labels ?? []) q.push(`label:"${l.replace(/"/g, "")}"`);
  if (p.text?.trim()) q.push(p.text.trim());
  q.push(`sort:${p.sort === "updated" ? "updated-desc" : p.sort === "created" ? "created-desc" : "comments-desc"}`);
  return q.join(" ");
}

export async function searchItems(p: SearchParams, first = 40): Promise<Page<Item>> {
  const host = normalizeHost(p.host);
  const { data } = await withoutOptionalFields((lean) =>
    gql<any>(
      host,
      `query($q: String!, $first: Int!, $after: String) {
        search(query: $q, type: ISSUE, first: $first, after: $after) {
          issueCount
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on Issue { ${lean ? ITEM_FIELDS : ISSUE_FIELDS} }
            ... on PullRequest { ${PR_FIELDS} }
          }
        }
      }`,
      { q: buildSearchQuery(p), first, after: p.after ?? null },
    ),
  );
  return {
    items: await withAvatars(data.search.nodes.map(toItem).filter(Boolean) as Item[], host),
    totalCount: data.search.issueCount,
    hasNextPage: data.search.pageInfo.hasNextPage,
    endCursor: data.search.pageInfo.endCursor,
  };
}

// ------------------------------------------------------------- projects

function toProject(n: any, owner: string): ProjectSummary {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    owner,
    description: n.shortDescription ?? "",
    itemCount: n.total?.totalCount ?? 0,
    updatedAt: n.updatedAt,
  };
}

const PROJECT_SUMMARY = `id number title url shortDescription updatedAt closed total: items { totalCount }`;

export async function listProjects(hostArg?: string): Promise<{ projects: ProjectSummary[]; warnings: string[] }> {
  const host = normalizeHost(hostArg);
  const { data, warnings } = await gql<any>(
    host,
    `{
      viewer {
        login
        projectsV2(first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT_SUMMARY} } }
        organizations(first: 20) {
          nodes {
            login
            projectsV2(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT_SUMMARY} } }
          }
        }
      }
    }`,
    {},
    { tolerant: true },
  );
  const out: ProjectSummary[] = [];
  for (const n of data.viewer?.projectsV2?.nodes ?? [])
    if (n && !n.closed) out.push(toProject(n, data.viewer.login));
  for (const org of data.viewer?.organizations?.nodes ?? [])
    for (const n of org?.projectsV2?.nodes ?? [])
      if (n && !n.closed) out.push(toProject(n, org.login));
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { projects: out, warnings };
}

export async function getBoard(projectId: string, hostArg?: string, maxItems = 300): Promise<Board> {
  const host = normalizeHost(hostArg);
  const items: Item[] = [];
  let after: string | null = null;
  let project: ProjectSummary | null = null;
  let groupFields: BoardField[] = [];
  let truncated = false;

  while (items.length < maxItems) {
    const { data }: { data: any } = await gql<any>(
      host,
      `query($id: ID!, $after: String) {
        node(id: $id) {
          ... on ProjectV2 {
            ${PROJECT_SUMMARY}
            owner { ... on User { login } ... on Organization { login } }
            fields(first: 40) {
              nodes {
                ... on ProjectV2SingleSelectField { id name options { id name color } }
              }
            }
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 25) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
                content {
                  __typename
                  ... on Issue { ${ITEM_FIELDS} }
                  ... on PullRequest { ${PR_FIELDS} }
                  ... on DraftIssue { id title bodyText createdAt updatedAt }
                }
              }
            }
          }
        }
      }`,
      { id: projectId, after },
      { tolerant: true },
    );
    const node: any = data.node;
    if (!node) throw new GitHubError("unknown", "Project not found or not accessible.");
    project ??= toProject(node, node.owner?.login ?? "");
    if (!groupFields.length)
      groupFields = (node.fields.nodes as any[])
        .filter((f) => f?.options?.length)
        .map((f) => ({ id: f.id, name: f.name, options: f.options }))
        .sort((a, b) => (a.name === "Status" ? -1 : b.name === "Status" ? 1 : 0));

    for (const raw of node.items.nodes) {
      const item = toItem(raw.content);
      if (!item) continue;
      for (const v of raw.fieldValues.nodes) {
        const name = v?.field?.name;
        if (!name) continue;
        const val = v.name ?? v.text ?? v.title ?? (v.number != null ? String(v.number) : null);
        if (val != null) item.fields[name] = val;
      }
      // Board cards need their own identity (the same issue can sit on several boards).
      item.id = raw.id;
      items.push(item);
    }
    if (!node.items.pageInfo.hasNextPage) break;
    after = node.items.pageInfo.endCursor;
    if (items.length >= maxItems) truncated = true;
  }
  await withAvatars(items, host);
  return { project: project!, groupFields, items, truncated };
}

// --------------------------------------------------------------- detail

export async function getIssueDetail(repo: string, number: number, hostArg?: string): Promise<IssueDetail> {
  const host = normalizeHost(hostArg);
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new GitHubError("unknown", `Invalid repo "${repo}"; expected owner/name.`);
  const { data } = await withoutOptionalFields((lean) => gql<any>(
    host,
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issueOrPullRequest(number: $number) {
          __typename
          ... on Issue {
            ${lean ? ITEM_FIELDS : ISSUE_FIELDS}
            body
            ${lean ? "" : "closedByPullRequestsReferences(first: 5) { nodes { number title url state } }"}
            recent: comments(last: 5) { nodes { body createdAt author { login } } }
          }
          ... on PullRequest {
            ${PR_FIELDS}
            body
            recent: comments(last: 5) { nodes { body createdAt author { login } } }
          }
        }
      }
    }`,
    { owner, name, number },
  ));
  const n = data.repository?.issueOrPullRequest;
  const item = toItem(n);
  if (!item) throw new GitHubError("unknown", `${repo}#${number} not found.`);
  await withAvatars([item], host);
  return {
    ...item,
    body: n.body ?? "",
    linkedPrs: (n.closedByPullRequestsReferences?.nodes ?? []).map((p: any) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      state: p.state,
    })),
    recentComments: (n.recent?.nodes ?? []).map((c: any) => ({
      author: c.author?.login ?? "ghost",
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}
