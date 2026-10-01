import { useEffect, useMemo, useState } from "preact/hooks";
import type { IssueDetail, Item } from "../shared/types.ts";
import type { Host } from "./host.ts";
import { MODES, buildPrompt, defaultMode, modesFor, type Mode } from "./prompt.ts";
import { renderMarkdown } from "./markdown.ts";
import { timeAgo, cx } from "./util.ts";
import { Avatars, LabelChip, StateIcon, Svg } from "./ui.tsx";
import { fetchDetail, peekDetail } from "./cache.ts";

const shorten = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

type Props = {
  item: Item;
  host: Host;
  /** GitHub instance the item belongs to (undefined = default). */
  ghHost?: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  onClose: () => void;
  /** Start a new thread with exactly this text. */
  onStart: (prompt: string, label: string) => Promise<void>;
  /** Attach this text to the open composer so the user can pick a model and send. */
  onAttach: (prompt: string, title: string) => Promise<void>;
  onCopy: (text: string) => Promise<void>;
};

export function Detail({ item, host, ghHost, mode, onMode, onClose, onStart, onAttach, onCopy }: Props) {
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload full text whenever the focused item changes.
  useEffect(() => {
    setDetail(item.repo && item.number != null ? (peekDetail(item.repo, item.number, ghHost) ?? null) : null);
    setErr(null);
    setNotes("");
    setShowPrompt(false);
    setEdited(null);
    if (item.kind === "draft" || !item.repo || item.number == null) return;
    let cancelled = false;
    fetchDetail(host, item.repo, item.number, ghHost)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setErr(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const full: Item | IssueDetail = detail ?? item;
  const modes = modesFor(item);
  const active: Mode = modes.some((m) => m.id === mode) ? mode : defaultMode(item);
  const generated = useMemo(() => buildPrompt({ item: full, mode: active, notes, host: ghHost }), [full, active, notes, ghHost]);
  // Hand edits win until the inputs that generated the prompt change again.
  useEffect(() => setEdited(null), [generated]);
  const prompt = edited ?? generated;
  const label = item.repo && item.number != null ? `${item.repo}#${item.number}` : item.title;
  // What the composer chip says, e.g. "Plan first · acme/api#482 Webhook retries exhaust the…"
  const chipTitle = shorten(`${MODES.find((m) => m.id === active)!.label} · ${label}${item.number != null ? " " + item.title : ""}`, 64);
  const html = useMemo(() => (detail ? renderMarkdown(detail.body) : ""), [detail]);

  const start = async () => {
    setBusy(true);
    try {
      await onStart(prompt, label);
    } finally {
      setBusy(false);
    }
  };

  const onBodyClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[data-ext]") as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      host.openLink(a.getAttribute("href")!);
    }
  };

  return (
    <aside class="detail" aria-label="Details">
      <header>
        <div class="crumb">
          <StateIcon item={item} />
          <span>{item.repo ?? "Draft"}</span>
          {item.number != null && <span class="num">#{item.number}</span>}
          <span class={cx("pill", item.state.toLowerCase())}>{item.state.toLowerCase()}</span>
        </div>
        <div class="head-actions">
          {item.url && (
            <button class="icon-btn" title="Open on GitHub" onClick={() => host.openLink(item.url!)}>
              <Svg d="link" />
            </button>
          )}
          <button class="icon-btn" title="Close (Esc)" onClick={onClose}>
            <Svg d="close" />
          </button>
        </div>
      </header>

      <div class="scroll">
        <h2>{item.title}</h2>
        <div class="meta">
          {item.author && <span>opened by <b>{item.author}</b></span>}
          {item.createdAt && <span>{timeAgo(item.createdAt)}</span>}
          {item.comments > 0 && (
            <span class="with-icon"><Svg d="comment" size={13} />{item.comments}</span>
          )}
          {item.milestone && <span>🏁 {item.milestone}</span>}
        </div>

        {(item.labels.length > 0 || item.assignees.length > 0 || item.projects.length > 0 || Object.keys(item.fields).length > 0) && (
          <div class="facts">
            {item.labels.length > 0 && <div class="chips">{item.labels.map((l) => <LabelChip key={l.name} label={l} />)}</div>}
            {item.assignees.length > 0 && (
              <div class="fact"><span>Assignees</span><Avatars people={item.assignees} max={5} />{item.assignees.map((a) => a.login).join(", ")}</div>
            )}
            {item.projects.map((p) => (
              <div class="fact" key={p.title}><span>Project</span>{p.title}{p.status && <em class="status">{p.status}</em>}</div>
            ))}
            {Object.entries(item.fields)
              .filter(([k]) => !["Title", "Assignees", "Labels"].includes(k))
              .map(([k, v]) => (
                <div class="fact" key={k}><span>{k}</span>{v}</div>
              ))}
          </div>
        )}

        {item.kind !== "draft" && !detail && !err && <div class="body-loading"><i /><i /><i style={{ width: "60%" }} /></div>}
        {err && <p class="error-text">Couldn't load the full text: {err}</p>}
        {detail && detail.linkedPrs.length > 0 && (
          <div class="linked">
            {detail.linkedPrs.map((p) => (
              <button key={p.number} class="linked-pr" onClick={() => host.openLink(p.url)}>
                <Svg d="pr" size={14} class={`state ${p.state.toLowerCase()}`} /> #{p.number} {p.title}
              </button>
            ))}
          </div>
        )}
        {detail && (html ? <div class="md" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} /> : <p class="muted">No description provided.</p>)}
        {item.kind === "draft" && item.excerpt && <p class="md">{item.excerpt}</p>}

        {detail && detail.recentComments.length > 0 && (
          <details class="comments">
            <summary>{detail.recentComments.length} recent comment{detail.recentComments.length > 1 ? "s" : ""}</summary>
            {detail.recentComments.map((c, i) => (
              <div class="comment" key={i}>
                <div class="meta"><b>{c.author}</b><span>{timeAgo(c.createdAt)}</span></div>
                <div class="md" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body.slice(0, 1500)) }} />
              </div>
            ))}
          </details>
        )}
      </div>

      <footer class="launch">
        <div class="modes" role="radiogroup" aria-label="Task mode">
          {modes.map((m) => (
            <button key={m.id} role="radio" aria-checked={m.id === active} class={cx(m.id === active && "on")} onClick={() => onMode(m.id)} title={m.hint}>
              {m.label}
            </button>
          ))}
        </div>
        <p class="hint">{MODES.find((m) => m.id === active)!.hint}</p>
        <textarea
          rows={2}
          placeholder="Additional instructions (optional)…"
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
        {showPrompt && (
          <>
            <textarea
              class="prompt-edit"
              aria-label="Prompt sent to Codex"
              rows={9}
              spellcheck={false}
              value={prompt}
              onInput={(e) => setEdited((e.target as HTMLTextAreaElement).value)}
            />
            {edited != null && <button class="ghost reset" onClick={() => setEdited(null)}>Reset to generated prompt</button>}
          </>
        )}
        <div class="launch-actions">
          <button class="primary" disabled={busy} onClick={start}>
            <Svg d="play" size={13} /> {busy ? "Starting…" : host.canStartThreads ? "Start in new thread" : "Copy task prompt"}
          </button>
        </div>
        <div class="launch-actions secondary">
          <button onClick={() => onCopy(prompt)} title="Copy the prompt to your clipboard">Copy prompt</button>
          <button onClick={() => onAttach(prompt, chipTitle)} title="Attach the prompt to the open composer, so you can choose a model before sending">
            Add to composer
          </button>
          <button class="ghost" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide prompt" : "Edit prompt"}</button>
        </div>
        <p class="hint small">New threads use your default model. To choose one first, use <b>Add to composer</b>, pick the model there, then send.</p>
      </footer>
    </aside>
  );
}
