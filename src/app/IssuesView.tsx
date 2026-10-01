import { useMemo } from "preact/hooks";
import type { Item, Page, SearchParams } from "../shared/types.ts";
import { Avatars, Checkbox, Empty, LabelChip, Segmented, Skeleton, Spinner, StateIcon, Svg } from "./ui.tsx";
import { cx, timeAgo } from "./util.ts";

type Props = {
  params: SearchParams;
  onParams: (p: Partial<SearchParams>) => void;
  page: Page<Item> | null;
  /** A request is in flight. Never blocks: existing results stay on screen and interactive. */
  refreshing: boolean;
  /** The list on screen belongs to an older query, so it's shown muted until the new one lands. */
  dim: boolean;
  /** Set while showing saved results from this timestamp. */
  staleAt: number | null;
  error: string | null;
  onRetry: () => void;
  onHover: (i: Item | null) => void;
  loadingMore: boolean;
  onMore: () => void;
  focusId: string | null;
  checked: Set<string>;
  onFocus: (i: Item) => void;
  onCheck: (i: Item, v: boolean) => void;
  onQuickStart: (i: Item) => void;
  groupByRepo: boolean;
  onGroup: (v: boolean) => void;
  quickLabel: string;
};

export function IssueRow({
  item, focused, checked, onFocus, onCheck, onQuickStart, onHover, quickLabel, showRepo = true,
}: {
  item: Item; focused: boolean; checked: boolean; showRepo?: boolean; quickLabel: string;
  onFocus: (i: Item) => void; onCheck: (i: Item, v: boolean) => void; onQuickStart: (i: Item) => void;
  onHover: (i: Item | null) => void;
}) {
  return (
    <li
      class={cx("row", focused && "focused", checked && "checked")}
      data-id={item.id}
      tabIndex={0}
      onClick={() => onFocus(item)}
      onKeyDown={(e) => e.key === "Enter" && onFocus(item)}
      onMouseEnter={() => onHover(item)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(item)}
    >
      <Checkbox checked={checked} onChange={(v) => onCheck(item, v)} label={`Select ${item.title}`} />
      <StateIcon item={item} />
      <div class="main">
        <div class="title">
          <span class="t">{item.title}</span>
          {item.labels.slice(0, 4).map((l) => <LabelChip key={l.name} label={l} />)}
          {item.labels.length > 4 && <span class="muted">+{item.labels.length - 4}</span>}
        </div>
        <div class="sub">
          {showRepo && item.repo && <span class="repo">{item.repo}</span>}
          {item.number != null && <span>#{item.number}</span>}
          {item.author && <span>by {item.author}</span>}
          {item.comments > 0 && <span class="with-icon"><Svg d="comment" size={12} />{item.comments}</span>}
          <span>{timeAgo(item.updatedAt)}</span>
          {item.projects.map((p) => (
            <span class="proj" key={p.title}>{p.title}{p.status ? ` · ${p.status}` : ""}</span>
          ))}
        </div>
      </div>
      <Avatars people={item.assignees} />
      <button
        class="quick"
        title={quickLabel}
        aria-label={quickLabel}
        onClick={(e) => { e.stopPropagation(); onQuickStart(item); }}
      >
        <Svg d="play" size={12} />
      </button>
    </li>
  );
}

export function IssuesView(p: Props) {
  const items = p.page?.items ?? [];
  const repos = useMemo(() => [...new Set(items.map((i) => i.repo).filter(Boolean) as string[])].sort(), [items]);
  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((i) => i.labels.forEach((l) => counts.set(l.name, (counts.get(l.name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [items]);

  const groups = useMemo(() => {
    if (!p.groupByRepo) return [{ name: "", items }];
    const m = new Map<string, Item[]>();
    items.forEach((i) => m.set(i.repo ?? "—", [...(m.get(i.repo ?? "—") ?? []), i]));
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [items, p.groupByRepo]);

  const activeLabels = p.params.labels ?? [];
  const toggleLabel = (l: string) =>
    p.onParams({ labels: activeLabels.includes(l) ? activeLabels.filter((x) => x !== l) : [...activeLabels, l] });

  return (
    <section class="view">
      <div class="filters">
        <Segmented
          label="Scope"
          value={p.params.scope === "all" ? "involves" : p.params.scope}
          onChange={(scope) => p.onParams({ scope, repo: undefined })}
          options={[
            { id: "involves", label: "Involving me" },
            { id: "assigned", label: "Assigned" },
            { id: "author", label: "Created" },
            { id: "mentions", label: "Mentioned" },
          ]}
        />
        <Segmented label="Kind" value={p.params.kind} onChange={(kind) => p.onParams({ kind })}
          options={[{ id: "issue", label: "Issues" }, { id: "pr", label: "PRs" }, { id: "any", label: "Both" }]} />
        <Segmented label="State" value={p.params.state} onChange={(state) => p.onParams({ state })}
          options={[{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }]} />
        <select aria-label="Repository" value={p.params.repo ?? ""} onChange={(e) => p.onParams({ repo: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">All repositories</option>
          {p.params.repo && !repos.includes(p.params.repo) && <option value={p.params.repo}>{p.params.repo}</option>}
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Sort" value={p.params.sort} onChange={(e) => p.onParams({ sort: (e.target as HTMLSelectElement).value as SearchParams["sort"] })}>
          <option value="updated">Recently updated</option>
          <option value="created">Newest</option>
          <option value="comments">Most commented</option>
        </select>
        <label class="toggle"><input type="checkbox" checked={p.groupByRepo} onChange={(e) => p.onGroup((e.target as HTMLInputElement).checked)} /> Group by repo</label>
      </div>

      {(labels.length > 0 || activeLabels.length > 0) && (
        <div class="chip-row" aria-label="Label filters">
          {[...new Set([...activeLabels, ...labels.map(([n]) => n)])].map((n) => (
            <button key={n} class={cx("chip", activeLabels.includes(n) && "on")} onClick={() => toggleLabel(n)}>{n}</button>
          ))}
        </div>
      )}

      <div class="count" aria-live="polite">
        {p.refreshing ? (
          <span class="note"><Spinner />{p.page ? (p.staleAt ? `Saved results from ${timeAgo(new Date(p.staleAt).toISOString())} · updating…` : "Updating…") : "Loading from GitHub…"}</span>
        ) : p.page ? (
          `${p.page.totalCount.toLocaleString()} result${p.page.totalCount === 1 ? "" : "s"}${p.page.totalCount > items.length ? ` · showing ${items.length}` : ""}`
        ) : ""}
      </div>

      <div class="list-scroll">
        {!p.page ? (
          p.error ? (
            <Empty title="Couldn't load issues" icon={<Svg d="issue" size={28} />}>
              {p.error} <button class="ghost link" onClick={p.onRetry}>Try again</button>
            </Empty>
          ) : (
            <Skeleton />
          )
        ) : items.length === 0 ? (
          <Empty title="Nothing here" icon={<Svg d="issue" size={28} />}>
            No {p.params.kind === "pr" ? "pull requests" : "issues"} match these filters. Try “All” state or a different scope.
          </Empty>
        ) : (
          <div class={cx(p.dim && "dim")}>
            {groups.map((g) => (
              <div key={g.name} class="group">
                {g.name && <h4 class="group-head">{g.name}<span>{g.items.length}</span></h4>}
                <ul class="rows">
                  {g.items.map((i) => (
                    <IssueRow key={i.id} item={i} showRepo={!p.groupByRepo} focused={p.focusId === i.id} checked={p.checked.has(i.id)}
                      onFocus={p.onFocus} onCheck={p.onCheck} onQuickStart={p.onQuickStart} onHover={p.onHover} quickLabel={p.quickLabel} />
                  ))}
                </ul>
              </div>
            ))}
            {p.page?.hasNextPage && (
              <button class="more-btn" disabled={p.loadingMore} onClick={p.onMore}>{p.loadingMore ? <span class="note"><Spinner />Loading more…</span> : "Load more"}</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
