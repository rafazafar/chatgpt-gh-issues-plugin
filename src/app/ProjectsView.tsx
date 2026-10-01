import { useMemo, useState } from "preact/hooks";
import type { Board, Item, ProjectSummary } from "../shared/types.ts";
import { Avatars, Checkbox, Empty, LabelChip, Skeleton, Spinner, StateIcon, Svg } from "./ui.tsx";
import { cx, projectColor, timeAgo } from "./util.ts";

type Props = {
  projects: ProjectSummary[] | null;
  warning: string | null;
  projectId: string | null;
  onProject: (id: string) => void;
  board: Board | null;
  /** Updating in the background; the board on screen stays interactive. */
  refreshing: boolean;
  staleAt: number | null;
  error: string | null;
  onHover: (i: Item | null) => void;
  groupBy: string | null;
  onGroupBy: (name: string) => void;
  focusId: string | null;
  checked: Set<string>;
  onFocus: (i: Item) => void;
  onCheck: (i: Item, v: boolean) => void;
  onQuickStart: (i: Item) => void;
  quickLabel: string;
};

function Card({ item, hide, ...p }: { item: Item; hide: string; focused: boolean; checked: boolean; quickLabel: string } & Pick<Props, "onFocus" | "onCheck" | "onQuickStart" | "onHover">) {
  const extras = Object.entries(item.fields).filter(([k]) => !["Title", "Assignees", "Labels", hide].includes(k)).slice(0, 3);
  return (
    <li class={cx("card", p.focused && "focused", p.checked && "checked")} tabIndex={0} data-id={item.id}
      onClick={() => p.onFocus(item)} onKeyDown={(e) => e.key === "Enter" && p.onFocus(item)}
      onMouseEnter={() => p.onHover(item)} onMouseLeave={() => p.onHover(null)} onFocus={() => p.onHover(item)}>
      <div class="card-top">
        <StateIcon item={item} size={14} />
        <span class="sub">{item.repo ? `${item.repo.split("/")[1]} #${item.number}` : "Draft"}</span>
        <span class="spacer" />
        <Checkbox checked={p.checked} onChange={(v) => p.onCheck(item, v)} label={`Select ${item.title}`} />
      </div>
      <div class="card-title">{item.title}</div>
      {(item.labels.length > 0 || extras.length > 0) && (
        <div class="card-chips">
          {item.labels.slice(0, 2).map((l) => <LabelChip key={l.name} label={l} />)}
          {extras.map(([k, v]) => <span class="field" key={k} title={k}>{v}</span>)}
        </div>
      )}
      <div class="card-foot">
        <span class="sub">{timeAgo(item.updatedAt)}</span>
        <span class="spacer" />
        <Avatars people={item.assignees} max={2} />
        <button class="quick" title={p.quickLabel} aria-label={p.quickLabel} onClick={(e) => { e.stopPropagation(); p.onQuickStart(item); }}>
          <Svg d="play" size={11} />
        </button>
      </div>
    </li>
  );
}

export function ProjectsView(p: Props) {
  const [q, setQ] = useState("");
  const [hideDone, setHideDone] = useState(false);

  const field = p.board?.groupFields.find((f) => f.name === p.groupBy) ?? p.board?.groupFields[0] ?? null;

  const columns = useMemo(() => {
    if (!p.board) return [];
    const needle = q.trim().toLowerCase();
    const items = p.board.items.filter((i) => !needle || `${i.title} ${i.repo} ${i.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(needle));
    const names = field ? field.options.map((o) => o.name) : [];
    const cols = (field ? field.options : []).map((o) => ({
      name: o.name, color: projectColor(o.color), items: items.filter((i) => i.fields[field!.name] === o.name),
    }));
    const none = items.filter((i) => !field || !names.includes(i.fields[field.name]));
    if (none.length || !field) cols.unshift({ name: field ? `No ${field.name}` : "All items", color: projectColor("GRAY"), items: none });
    return hideDone ? cols.filter((c) => !/^(done|closed|complete|completed|shipped)$/i.test(c.name)) : cols;
  }, [p.board, field, q, hideDone]);

  if (!p.projects) return <section class="view"><Skeleton rows={5} /></section>;

  if (p.projects.length === 0)
    return (
      <section class="view">
        <Empty title="No projects found" icon={<Svg d="draft" size={28} />}>
          {p.warning ?? "This account can't see any GitHub Projects."} If you expected some, run <code>gh auth refresh -s read:project</code>.
        </Empty>
      </section>
    );

  const groups = new Map<string, ProjectSummary[]>();
  p.projects.forEach((pr) => groups.set(pr.owner, [...(groups.get(pr.owner) ?? []), pr]));

  return (
    <section class="view">
      <div class="filters">
        <select aria-label="Project" class="project-select" value={p.projectId ?? ""} onChange={(e) => p.onProject((e.target as HTMLSelectElement).value)}>
          <option value="" disabled>Choose a project…</option>
          {[...groups.entries()].map(([owner, list]) => (
            <optgroup key={owner} label={owner}>
              {list.map((pr) => <option key={pr.id} value={pr.id}>{pr.title} ({pr.itemCount})</option>)}
            </optgroup>
          ))}
        </select>
        {p.board && p.board.groupFields.length > 1 && (
          <select aria-label="Group by" value={field?.name} onChange={(e) => p.onGroupBy((e.target as HTMLSelectElement).value)}>
            {p.board.groupFields.map((f) => <option key={f.id} value={f.name}>Group by {f.name}</option>)}
          </select>
        )}
        <div class="search small">
          <Svg d="search" size={13} />
          <input placeholder="Filter cards…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </div>
        <label class="toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone((e.target as HTMLInputElement).checked)} /> Hide done</label>
        {p.refreshing && (
          <span class="note muted"><Spinner />{p.board ? (p.staleAt ? `Saved ${timeAgo(new Date(p.staleAt).toISOString())} · updating…` : "Updating…") : "Loading board…"}</span>
        )}
      </div>

      {p.error ? (
        <Empty title="Couldn't load this project">{p.error}</Empty>
      ) : !p.projectId ? (
        <Empty title="Pick a project" icon={<Svg d="draft" size={28} />}>Choose a GitHub Project above to see its board. Start a task from any card.</Empty>
      ) : !p.board ? (
        <div class="board"><Skeleton rows={4} /></div>
      ) : (
        <>
          {p.board.truncated && <div class="banner">Showing the first {p.board.items.length} items of {p.board.project.itemCount}.</div>}
          <div class="board" role="list">
            {columns.map((c) => (
              <div class={cx("column", c.items.length === 0 && "empty-col")} key={c.name} role="listitem">
                <h4><i style={{ background: c.color }} />{c.name}<span>{c.items.length}</span></h4>
                <ul>
                  {c.items.map((i) => (
                    <Card key={i.id} item={i} hide={field?.name ?? ""} focused={p.focusId === i.id} checked={p.checked.has(i.id)}
                      onFocus={p.onFocus} onCheck={p.onCheck} onQuickStart={p.onQuickStart} onHover={p.onHover} quickLabel={p.quickLabel} />
                  ))}
                  {c.items.length === 0 && <li class="col-empty">Empty</li>}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
