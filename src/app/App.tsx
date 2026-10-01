import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Board, IssueDetail, Item, OpenResult, Page, ProjectSummary, SearchParams, Viewer } from "../shared/types.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";
import { connectHost, type Host } from "./host.ts";
import { buildContext, buildPrompt, defaultMode, modesFor, type Mode } from "./prompt.ts";
import { Resizer } from "./Resizer.tsx";
import { Detail } from "./Detail.tsx";
import { IssuesView } from "./IssuesView.tsx";
import { ProjectsView } from "./ProjectsView.tsx";
import { Empty, Segmented, Svg } from "./ui.tsx";
import { load, save } from "./util.ts";

type Tab = "issues" | "projects";
type Toast = { msg: string; tone: "ok" | "err" } | null;
type Fatal = NonNullable<OpenResult["error"]> | null;

export function App() {
  const [host, setHost] = useState<Host | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [tab, setTab] = useState<Tab>(() => load<Tab>("tab", "issues"));
  const [mode, setMode] = useState<Mode>(() => load<Mode>("mode", "plan"));
  const [groupByRepo, setGroupByRepo] = useState(() => load("groupByRepo", false));
  const [toast, setToast] = useState<Toast>(null);
  const [detailW, setDetailW] = useState(() => load<number>("detailW", 440));

  // issues
  const [params, setParams] = useState<SearchParams>(DEFAULT_SEARCH);
  const [page, setPage] = useState<Page<Item> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");

  // projects
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projWarn, setProjWarn] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => load<string | null>("projectId", null));
  const [board, setBoard] = useState<Board | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(() => load<string | null>("groupBy", null));
  const boards = useRef(new Map<string, Board>());
  const [nonce, setNonce] = useState(0);

  // selection
  const [focus, setFocus] = useState<Item | null>(null);
  const [checked, setChecked] = useState<Map<string, Item>>(new Map());
  const [confirming, setConfirming] = useState(false);

  const hostRef = useRef<Host | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const reqSeq = useRef(0);

  const say = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 4500);
  }, []);

  const apply = useCallback((r: OpenResult) => {
    if (r.error) {
      setFatal(r.error);
      setLoading(false);
      return;
    }
    setFatal(null);
    if (r.viewer) setViewer(r.viewer);
    if (r.issues) setPage(r.issues);
    if (r.params) {
      setParams(r.params);
      setText(r.params.text ?? "");
    }
    setLoading(false);
  }, []);

  // ---- boot
  useEffect(() => {
    let got = false;
    connectHost((r) => {
      got = true;
      apply(r);
    }).then((h) => {
      hostRef.current = h;
      setHost(h);
      // The host normally pushes the initial tool result; fall back to asking for it.
      window.setTimeout(async () => {
        if (got) return;
        try {
          apply(await h.callTool<OpenResult>("launchpad.open"));
        } catch (e) {
          setFatal({ code: "unknown", message: String((e as Error).message) });
          setLoading(false);
        }
      }, 2500);
    });
  }, []);

  // ---- issues
  const runSearch = useCallback(async (next: SearchParams, append = false) => {
    const h = hostRef.current;
    if (!h) return;
    const seq = ++reqSeq.current;
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const res = await h.callTool<Page<Item>>("launchpad.search", { ...next });
      if (seq !== reqSeq.current) return;
      setPage((prev) => (append && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
    } catch (e) {
      if (seq === reqSeq.current) say((e as Error).message, "err");
    } finally {
      if (seq === reqSeq.current) (setLoading(false), setLoadingMore(false));
    }
  }, [say]);

  const changeParams = (patch: Partial<SearchParams>) => {
    const next = { ...paramsRef.current, ...patch, after: null };
    setParams(next);
    void runSearch(next);
  };

  useEffect(() => {
    if (!host || text === (params.text ?? "")) return;
    const t = window.setTimeout(() => changeParams({ text: text || undefined }), 400);
    return () => window.clearTimeout(t);
  }, [text]);

  // ---- projects
  const loadProjects = useCallback(async (force = false) => {
    const h = hostRef.current;
    if (!h) return;
    if (force) boards.current.clear();
    try {
      const r = await h.callTool<{ projects: ProjectSummary[]; warnings: string[] }>("launchpad.projects");
      setProjects(r.projects);
      setProjWarn(r.warnings[0] ?? null);
      setProjectId((cur) => {
        if (cur && r.projects.some((p) => p.id === cur)) return cur;
        return r.projects.find((p) => p.itemCount > 0)?.id ?? null;
      });
    } catch (e) {
      setProjects([]);
      setProjWarn((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (tab === "projects" && host && projects === null) void loadProjects();
  }, [tab, host]);

  useEffect(() => {
    const h = hostRef.current;
    if (!projectId || !h || tab !== "projects") return;
    save("projectId", projectId);
    const cached = boards.current.get(projectId);
    if (cached) {
      setBoard(cached);
      setBoardError(null);
      return;
    }
    let cancelled = false;
    setBoardLoading(true);
    setBoardError(null);
    h.callTool<Board>("launchpad.board", { projectId })
      .then((b) => {
        if (cancelled) return;
        boards.current.set(projectId, b);
        setBoard(b);
      })
      .catch((e) => !cancelled && setBoardError((e as Error).message))
      .finally(() => !cancelled && setBoardLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, tab, host, nonce]);

  const refresh = () => {
    if (tab === "issues") return void runSearch({ ...params, after: null });
    boards.current.clear();
    setBoard(null);
    void loadProjects(true);
    setNonce((n) => n + 1);
  };

  // ---- launching
  const withDetail = async (items: Item[]): Promise<(Item | IssueDetail)[]> =>
    Promise.all(
      items.map(async (i) => {
        if (i.kind === "draft" || !i.repo || i.number == null) return i;
        try {
          return await hostRef.current!.callTool<IssueDetail>("launchpad.issue", { repo: i.repo, number: i.number });
        } catch {
          return i;
        }
      }),
    );

  const describe = (i: Item) => (i.repo && i.number != null ? `${i.repo}#${i.number}` : i.title);
  const modeFor = (i: Item) => (modesFor(i).some((x) => x.id === mode) ? mode : defaultMode(i));

  const startPrompt = async (prompt: string, label: string) => {
    try {
      const how = await hostRef.current!.startThread(prompt);
      say(how === "sent" ? `Started a thread for ${label}` : "Prompt copied — paste it into a new thread");
    } catch (e) {
      say((e as Error).message, "err");
    }
  };

  const quickStart = async (item: Item) => {
    const [full] = await withDetail([item]);
    await startPrompt(buildPrompt({ item: full, mode: modeFor(item) }), describe(item));
  };

  const startMany = async () => {
    const items = [...checked.values()];
    setConfirming(false);
    const full = await withDetail(items);
    let sent = 0;
    for (const it of full) {
      try {
        const how = await hostRef.current!.startThread(buildPrompt({ item: it, mode: modeFor(it) }));
        if (how === "copied") {
          say("Prompts can only be copied here — start tasks one at a time.", "err");
          return;
        }
        sent++;
      } catch (e) {
        say(`Stopped after ${sent}: ${(e as Error).message}`, "err");
        return;
      }
    }
    say(`Started ${sent} thread${sent === 1 ? "" : "s"}`);
    setChecked(new Map());
  };

  const attachText = async (text: string, what: string) => {
    try {
      const how = await hostRef.current!.attachContext(text);
      say(how === "attached" ? `Added ${what} to the composer — pick a model and send` : "Copied to clipboard");
    } catch (e) {
      say((e as Error).message, "err");
    }
  };

  const copy = async (text: string) => {
    try {
      await hostRef.current!.copyText(text);
      say("Prompt copied to clipboard");
    } catch {
      say("Couldn't access the clipboard", "err");
    }
  };

  const toggleCheck = (i: Item, v: boolean) => {
    setChecked((m) => {
      const n = new Map(m);
      v ? n.set(i.id, i) : n.delete(i.id);
      return n;
    });
    setConfirming(false);
  };

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (e.key === "Escape") {
        if (typing) return el.blur();
        setFocus(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        (document.getElementById("search") as HTMLInputElement | null)?.focus();
      } else if (e.key === "j" || e.key === "k") {
        const els = [...document.querySelectorAll<HTMLElement>(".row[data-id], .card[data-id]")];
        if (!els.length) return;
        const cur = els.findIndex((x) => x.classList.contains("focused"));
        const next = els[Math.min(els.length - 1, Math.max(0, cur + (e.key === "j" ? 1 : -1)))];
        next.click();
        next.scrollIntoView({ block: "nearest" });
      } else if (e.key === "x") {
        document.querySelector<HTMLElement>(".row.focused .check, .card.focused .check")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeTab = (t: Tab) => {
    setTab(t);
    save("tab", t);
    setFocus(null);
    setChecked(new Map());
  };

  const quickLabel = useMemo(
    () => `Start a new thread now (${mode === "plan" ? "plan first" : mode})`,
    [mode],
  );

  // ---- render
  if (fatal) return <Fatal error={fatal} onRetry={async () => { setFatal(null); setLoading(true); if (host) apply(await host.callTool<OpenResult>("launchpad.open").catch((e) => ({ error: { code: "unknown" as const, message: String(e.message) } }))); }} />;

  return (
    <div class={`app ${focus ? "has-detail" : ""} ${host?.mode === "codex" ? "host-codex" : ""}`} style={{ "--detail-w": `${detailW}px` }}>
      <header class="topbar">
        <div class="brand"><Svg d="play" size={13} /> Issue Launchpad</div>
        <Segmented label="View" value={tab} onChange={changeTab} options={[{ id: "issues", label: "Issues" }, { id: "projects", label: "Projects" }]} />
        <div class="spacer" />
        {tab === "issues" && (
          <div class="search">
            <Svg d="search" size={13} />
            <input id="search" placeholder="Search · try label:bug no:assignee   ( / )" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </div>
        )}
        <button class="icon-btn" title="Refresh" aria-label="Refresh" onClick={refresh}><Svg d="refresh" /></button>
        {viewer && (
          <div class="viewer" title={viewer.orgs.length ? `Orgs: ${viewer.orgs.join(", ")}` : viewer.login}>
            <img src={viewer.avatarUrl} alt="" width="22" height="22" />
            <span>{viewer.login}</span>
          </div>
        )}
      </header>

      <main>
        {tab === "issues" ? (
          <IssuesView
            params={params} onParams={changeParams} page={page} loading={loading} loadingMore={loadingMore}
            onMore={() => page?.endCursor && runSearch({ ...params, after: page.endCursor }, true)}
            focusId={focus?.id ?? null} checked={new Set(checked.keys())} onFocus={setFocus} onCheck={toggleCheck}
            onQuickStart={quickStart} groupByRepo={groupByRepo} onGroup={(v) => { setGroupByRepo(v); save("groupByRepo", v); }}
            quickLabel={quickLabel}
          />
        ) : (
          <ProjectsView
            projects={projects} warning={projWarn} projectId={projectId} onProject={setProjectId}
            board={board} loading={boardLoading} error={boardError}
            groupBy={groupBy} onGroupBy={(g) => { setGroupBy(g); save("groupBy", g); }}
            focusId={focus?.id ?? null} checked={new Set(checked.keys())} onFocus={setFocus} onCheck={toggleCheck}
            onQuickStart={quickStart} quickLabel={quickLabel}
          />
        )}

        {focus && host && <Resizer width={detailW} onChange={setDetailW} onCommit={(w) => save("detailW", w)} />}
        {focus && host && (
          <Detail
            item={focus} host={host} mode={mode}
            onMode={(m) => { setMode(m); save("mode", m); }}
            onClose={() => setFocus(null)} onStart={startPrompt} onAttach={(t) => attachText(t, "the task")} onCopy={copy}
          />
        )}
      </main>

      {checked.size > 0 && (
        <div class="tray" role="region" aria-label="Selection">
          <b>{checked.size} selected</b>
          <button class="ghost" onClick={() => setChecked(new Map())}>Clear</button>
          <span class="spacer" />
          <button onClick={() => attachText(buildContext([...checked.values()]), `${checked.size} items`)}>Add all to composer</button>
          {confirming ? (
            <button class="primary danger" onClick={startMany}>Confirm: start {checked.size} threads</button>
          ) : (
            <button class="primary" onClick={() => (checked.size === 1 ? startMany() : setConfirming(true))}>
              <Svg d="play" size={12} /> Start {checked.size} thread{checked.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {toast && <div class={`toast ${toast.tone}`} role="status">{toast.msg}</div>}
    </div>
  );
}

function Fatal({ error, onRetry }: { error: NonNullable<Fatal>; onRetry: () => void }) {
  const title = error.code === "no_token" ? "Connect GitHub" : error.code === "bad_token" ? "GitHub rejected the token" : error.code === "network" ? "Can't reach GitHub" : "Something went wrong";
  return (
    <div class="fatal">
      <Empty title={title} icon={<Svg d="issue" size={32} />}>
        {error.message}
      </Empty>
      {error.code === "no_token" && (
        <pre class="prompt-preview">{`gh auth login\ngh auth refresh -s project   # for Projects boards`}</pre>
      )}
      <button class="primary" onClick={onRetry}>Try again</button>
    </div>
  );
}
