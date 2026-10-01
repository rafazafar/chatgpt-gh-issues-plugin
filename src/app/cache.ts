import type { Host } from "./host.ts";
import type { IssueDetail, SearchParams } from "../shared/types.ts";

/**
 * Stale-while-revalidate storage. Everything is kept in memory for the session and, when the
 * iframe allows localStorage, persisted so the next open can paint saved results instantly.
 */
type Entry<T> = { value: T; at: number };

const mem = new Map<string, Entry<unknown>>();
const PREFIX = "launchpad:cache:";
const INDEX = PREFIX + "_index";
const MAX_PERSISTED = 8;
const MAX_BYTES = 600_000;

export function cacheGet<T>(key: string): Entry<T> | undefined {
  const hit = mem.get(key);
  if (hit) return hit as Entry<T>;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) {
      const entry = JSON.parse(raw) as Entry<T>;
      mem.set(key, entry);
      return entry;
    }
  } catch {
    /* storage unavailable or corrupt: behave as a miss */
  }
  return undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  const entry: Entry<T> = { value, at: Date.now() };
  mem.set(key, entry);
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_BYTES) return;
    localStorage.setItem(PREFIX + key, raw);
    const index = (JSON.parse(localStorage.getItem(INDEX) ?? "[]") as string[]).filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_PERSISTED) localStorage.removeItem(PREFIX + index.shift()!);
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch {
    /* quota or sandbox: the in-memory copy is enough */
  }
}

/** Stable per-query key (ignores the pagination cursor). */
export const searchKey = (p: SearchParams) =>
  "issues:" + JSON.stringify([p.scope, p.kind, p.state, p.repo ?? "", p.text ?? "", [...(p.labels ?? [])].sort(), p.sort]);

// ---- issue details: deduplicated, short-lived, never persisted (bodies can be large)
const DETAIL_TTL = 3 * 60_000;
const details = new Map<string, { promise: Promise<IssueDetail>; value?: IssueDetail; at: number }>();
const detailKey = (repo: string, n: number) => `${repo}#${n}`;

export function peekDetail(repo: string, n: number): IssueDetail | undefined {
  const d = details.get(detailKey(repo, n));
  return d && Date.now() - d.at < DETAIL_TTL ? d.value : undefined;
}

/** Fetch once and share: hover-prefetch and the real open reuse the same request. */
export function fetchDetail(host: Host, repo: string, n: number): Promise<IssueDetail> {
  const key = detailKey(repo, n);
  const existing = details.get(key);
  if (existing && Date.now() - existing.at < DETAIL_TTL) return existing.promise;
  const entry: { promise: Promise<IssueDetail>; value?: IssueDetail; at: number } = {
    at: Date.now(),
    promise: host.callTool<IssueDetail>("launchpad.issue", { repo, number: n }).then(
      (v) => ((entry.value = v), v),
      (e) => (details.delete(key), Promise.reject(e)),
    ),
  };
  details.set(key, entry);
  return entry.promise;
}
