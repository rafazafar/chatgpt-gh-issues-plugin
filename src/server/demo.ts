/** Fake data for README screenshots and UI work: `DEMO=1 npm run dev`. No network, no real repos. */
import type { Board, IssueDetail, Item, OpenResult, Page, ProjectSummary, SearchParams } from "../shared/types.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";

const avatar = (letter: string, hue: number) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="hsl(${hue} 55% 52%)"/><text x="24" y="31" font-family="system-ui" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
  );
const ada = { login: "ada", avatarUrl: avatar("A", 265) };
const lin = { login: "linus", avatarUrl: avatar("L", 190) };
const grace = { login: "grace", avatarUrl: avatar("G", 20) };

const L = {
  bug: { name: "bug", color: "d73a4a" },
  feat: { name: "enhancement", color: "a2eeef" },
  docs: { name: "docs", color: "0075ca" },
  p0: { name: "P0", color: "b60205" },
  ready: { name: "ready", color: "0e8a16" },
  perf: { name: "performance", color: "fbca04" },
  ci: { name: "ci", color: "bfd4f2" },
  ux: { name: "ux", color: "d4c5f9" },
};

let n = 0;
const mk = (repo: string, number: number, title: string, labels: Item["labels"], assignees: Item["assignees"], ago: number, extra: Partial<Item> = {}): Item => ({
  id: `demo-${n++}`, kind: "issue", number, title, url: `https://github.com/${repo}/issues/${number}`, state: "OPEN",
  repo, author: "ada", labels, assignees, comments: (number * 7) % 6, milestone: null,
  createdAt: new Date(Date.now() - (ago + 400) * 60_000).toISOString(), updatedAt: new Date(Date.now() - ago * 60_000).toISOString(),
  excerpt: "", projects: [], fields: {}, ...extra,
});

const items: Item[] = [
  mk("acme/api", 482, "Webhook retries exhaust the queue under burst traffic", [L.bug, L.p0], [ada], 12, { projects: [{ title: "Platform roadmap", number: 4, status: "In progress" }] }),
  mk("acme/api", 479, "Add cursor pagination to /v2/events", [L.feat, L.ready], [lin], 55, { projects: [{ title: "Platform roadmap", number: 4, status: "Todo" }] }),
  mk("acme/web", 1203, "Dark mode flashes white on first paint", [L.bug, L.ux], [grace], 130),
  mk("acme/web", 1198, "Command palette: fuzzy match ignores acronyms", [L.feat, L.ux], [], 190, { projects: [{ title: "Platform roadmap", number: 4, status: "Backlog" }] }),
  mk("acme/api", 471, "Slow query on /v2/reports when filtering by tag", [L.perf], [ada, lin], 320),
  mk("acme/docs", 96, "Document the new rate-limit headers", [L.docs, L.ready], [grace], 480),
  mk("acme/web", 1187, "Flaky e2e: checkout › applies coupon", [L.ci, L.bug], [], 900),
  mk("acme/api", 455, "Support service-account tokens with scoped permissions", [L.feat], [lin], 1500, { projects: [{ title: "Platform roadmap", number: 4, status: "In progress" }] }),
  mk("acme/web", 1175, "Reduce bundle size of the charts page", [L.perf], [], 2400),
  mk("acme/docs", 91, "Quickstart still references the v1 SDK", [L.docs], [ada], 3100),
];

const BODY = `## Summary
Under burst traffic the webhook dispatcher keeps retrying failed deliveries with a fixed delay, which fills the queue and starves healthy tenants.

## Expected
- Retries use exponential backoff with jitter
- A failing endpoint can't consume more than its share of the queue
- Dead endpoints are paused after N consecutive failures

## Notes
Seen in production on 2026-09-28. Repro: \`scripts/burst.sh --tenants 40\`.

- [x] Reproduce locally
- [ ] Add backoff + jitter
- [ ] Per-tenant concurrency cap`;

const page = <T>(items: T[]): Page<T> => ({ items, totalCount: items.length, hasNextPage: false, endCursor: null });

export async function open(): Promise<OpenResult> {
  return { viewer: { login: "ada", name: "Ada", avatarUrl: ada.avatarUrl, orgs: ["acme"] }, issues: page(items), params: DEFAULT_SEARCH };
}
export const search = async (p: SearchParams) => {
  const needle = (p.text ?? "").toLowerCase();
  return page(items.filter((i) => (!p.repo || i.repo === p.repo) && (!needle || i.title.toLowerCase().includes(needle)) && (!p.labels?.length || p.labels.every((l) => i.labels.some((x) => x.name === l)))));
};

const project: ProjectSummary = { id: "demo-project", number: 4, title: "Platform roadmap", url: "https://github.com/orgs/acme/projects/4", owner: "acme", description: "", itemCount: items.length, updatedAt: new Date().toISOString() };
export const projects = async () => ({ projects: [project], warnings: [] as string[] });
export const board = async (): Promise<Board> => {
  const status = ["Backlog", "Todo", "In progress", "In review", "Done"];
  const placed = items.map((i, k) => ({ ...i, id: `card-${k}`, fields: { Status: i.projects[0]?.status ?? status[(k % 4)], ...(k % 3 === 0 ? { Priority: "High" } : {}) } }));
  placed[8] = { ...placed[8], state: "CLOSED", fields: { Status: "Done" } };
  return {
    project, truncated: false, items: placed,
    groupFields: [{ id: "s", name: "Status", options: [
      { id: "1", name: "Backlog", color: "GRAY" }, { id: "2", name: "Todo", color: "BLUE" }, { id: "3", name: "In progress", color: "YELLOW" },
      { id: "4", name: "In review", color: "PURPLE" }, { id: "5", name: "Done", color: "GREEN" } ] }],
  };
};
export const issue = async (repo: string, number: number): Promise<IssueDetail> => {
  const base = items.find((i) => i.repo === repo && i.number === number) ?? items[0];
  return { ...base, body: BODY, linkedPrs: [], recentComments: [{ author: "linus", body: "I can take this after the pagination work. Do we want per-tenant caps in v1?", createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() }] };
};
