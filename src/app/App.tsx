import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppError, Board, HostsInfo, IssueDetail, Item, Page, ProjectSummary, SearchParams, Viewer } from "../shared/types.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";
import { connectHost, type Attachment, type Host } from "./host.ts";
import { buildContext, buildPrompt, defaultMode, modesFor, type Mode } from "./prompt.ts";
import { Resizer } from "./Resizer.tsx";
import { AccountMenu, ConnectDialog, ConnectPanel } from "./Connect.tsx";
import { Detail } from "./Detail.tsx";
import { IssuesView } from "./IssuesView.tsx";
import { ProjectsView } from "./ProjectsView.tsx";
import { Segmented, Svg } from "./ui.tsx";
import { cacheGet, cacheSet, fetchDetail, searchKey, type Who } from "./cache.ts";
import { cx, load, normHost, save } from "./util.ts";

const chipLabel = (i: Item) => {
  const t = `${i.repo && i.number != null ? `${i.repo}#${i.number} ` : ""}${i.title}`;
  return t.length > 64 ? t.slice(0, 63).trimEnd() + "…" : t;
};

type Tab = "issues" | "projects";
type Toast = { msg: string; tone: "ok" | "err" } | null;
type Fatal = AppError | null;
const isAuthError = (code?: string) => code === "no_token" || code === "bad_token";

export function App() {
  const [host, setHost] = useState<Host | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [tab, setTab] = useState<Tab>(() => load<Tab>("tab", "issues"));
  const [mode, setMode] = useState<Mode>(() => load<Mode>("mode", "plan"));
  const [groupByRepo, setGroupByRepo] = useState(() => load("groupByRepo", false));
  const [toast, setToast] = useState<Toast>(null);
  const [detailW, setDetailW] = useState(() => load<number>("detailW", 440));

  // Loading is never exclusive: `busy` only drives the progress cues, the UI stays usable.
  const [busy, setBusy] = useState(0);
  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy((n) => n + 1);
    try {
      return await fn();
    } finally {
      setBusy((n) => n - 1);
    }
  }, []);

  // issues
  const [params, setParams] = useState<SearchParams>(() => ({ ...DEFAULT_SEARCH, ...load<Partial<SearchParams>>("params", {}), after: null }));
  const [page, setPage] = useState<Page<Item> | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null); // which query `page` belongs to
  const [staleAt, setStaleAt] = useState<number | null>(null); // set while showing saved results
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState(() => params.text ?? "");
  // Which GitHub (github.com or an Enterprise host) we're looking at. params.host is the source of truth.
  const [hostInfo, setHostInfo] = useState<HostsInfo | null>(null);
  const effHost = params.host ?? hostInfo?.default;
  const hk = () => `${paramsRef.current.host ?? ""}|${paramsRef.current.user ?? ""}`;
  const who = (): Who => ({ host: paramsRef.current.host, user: paramsRef.current.user });
  // Hosts the user added by hand (e.g. a company GitHub they only use over SSH for git).
  const [customHosts, setCustomHosts] = useState<string[]>(() => load<string[]>("customHosts", []));
  const customHostsRef = useRef(customHosts);
  customHostsRef.current = customHosts;
  const [connectOpen, setConnectOpen] = useState(false);

  // projects
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projWarn, setProjWarn] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => load<string | null>("projectId", null));
  const [board, setBoard] = useState<Board | null>(null);
  const [boardStaleAt, setBoardStaleAt] = useState<number | null>(null);
  const [boardRefreshing, setBoardRefreshing] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(() => load<string | null>("groupBy", null));
  const forceBoard = useRef(false);
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

  // ---- boot: connect, then load data in the background (saved results paint first)
  useEffect(() => {
    connectHost().then((h) => {
      hostRef.current = h;
      setHost(h);
    });
  }, []);

  const loadViewer = useCallback(() => {
    const h = hostRef.current!;
    const key = "viewer:" + hk();
    const saved = cacheGet<Viewer>(key);
    if (saved) setViewer(saved.value);
    void track(() =>
      h.callTool<Viewer>("launchpad.viewer", who()).then((v) => {
        cacheSet(key, v);
        setViewer(v);
      }),
    ).catch(() => undefined); // auth problems surface through the issue search
  }, [track]);

  // ---- issues
  const runSearch = useCallback(async (next: SearchParams, append = false) => {
    const h = hostRef.current;
    if (!h) return;
    const key = searchKey(next);
    const seq = ++reqSeq.current;

    if (!append) {
      // Saved results for exactly this query show instantly; fresh ones replace them when they land.
      const saved = cacheGet<Page<Item>>(key);
      if (saved) {
        setPage(saved.value);
        setPageKey(key);
        setStaleAt(saved.at);
      }
      setRefreshing(true);
    } else setLoadingMore(true);
    setLoadError(null);

    await track(async () => {
      try {
        const res = await h.callTool<Page<Item>>("launchpad.search", { ...next });
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        if (append) setPage((prev) => (prev ? { ...res, items: [...prev.items, ...res.items] } : res));
        else {
          cacheSet(key, res);
          setPage(res);
          setPageKey(key);
          setStaleAt(null);
        }
        setFatal(null);
      } catch (e) {
        if (seq !== reqSeq.current) return;
        const err = e as Error & { code?: AppError["code"] };
        if (isAuthError(err.code)) setFatal({ code: err.code!, message: err.message });
        else {
          setLoadError(err.message);
          say(err.message, "err");
        }
      } finally {
        if (seq === reqSeq.current) {
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    });
  }, [say, track]);

  useEffect(() => {
    if (!host) return;
    loadViewer();
    void runSearch(paramsRef.current);
    void refreshHosts(true);
  }, [host]);

  /** Which hosts/accounts the CLI knows. Re-read whenever it may have changed (window focus, menu open). */
  const refreshHosts = useCallback(async (validate = false) => {
    const h = hostRef.current;
    if (!h) return;
    try {
      const info = await h.callTool<HostsInfo>("launchpad.hosts");
      setHostInfo(info);
      if (!validate) return;
      const { host: chosenHost, user: chosenUser } = paramsRef.current;
      if (chosenHost && !info.hosts.includes(chosenHost) && !customHostsRef.current.includes(chosenHost)) switchTo({});
      else if (chosenUser && info.accounts.some((a) => a.host === (chosenHost ?? info.default)) && !info.accounts.some((a) => a.host === (chosenHost ?? info.default) && a.login === chosenUser))
        switchTo({ host: chosenHost }); // the remembered account was removed: fall back to the active one
    } catch {
      /* the picker just keeps what it had */
    }
  }, []);

  useEffect(() => {
    const again = () => void refreshHosts();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [refreshHosts]);

  const api = useCallback(<T,>(name: string, args: Record<string, unknown> = {}) => hostRef.current!.callTool<T>(name, args), []);

  // Retry loading after the user fixed their sign-in.
  const reload = () => {
    setFatal(null);
    loadViewer();
    void runSearch(paramsRef.current);
    if (tab === "projects") void loadProjects();
  };

  const useHost = (h: string) => {
    const n = normHost(h);
    if (n !== "github.com" && !hostInfo?.hosts.includes(n)) {
      const next = [...new Set([...customHosts, n])];
      setCustomHosts(next);
      save("customHosts", next);
    }
    setConnectOpen(false);
    if (n !== (paramsRef.current.host ?? hostInfo?.default)) switchTo({ host: n });
    else reload();
  };

  const switchTo = ({ host: nextHost, user: nextUser }: { host?: string; user?: string }) => {
    const p: SearchParams = { ...DEFAULT_SEARCH, ...paramsRef.current, host: nextHost, user: nextUser, after: null, repo: undefined, labels: undefined, text: undefined };
    paramsRef.current = p;
    setParams(p);
    save("params", p);
    setText("");
    setPage(null);
    setPageKey(null);
    setStaleAt(null);
    setProjects(null);
    setProjectId(null);
    setBoard(null);
    setFocus(null);
    setChecked(new Map());
    setViewer(null);
    setLoadError(null);
    setFatal(null);
    loadViewer();
    void runSearch(p);
    if (tab === "projects") void loadProjects();
  };

  const changeParams = (patch: Partial<SearchParams>) => {
    const next = { ...paramsRef.current, ...patch, after: null };
    setParams(next);
    save("params", { ...next, after: undefined });
    void runSearch(next);
  };

  useEffect(() => {
    if (!host || text === (params.text ?? "")) return;
    const t = window.setTimeout(() => changeParams({ text: text || undefined }), 400);
    return () => window.clearTimeout(t);
  }, [text]);

  // ---- projects (list + boards are stale-while-revalidate too)
  const loadProjects = useCallback(async () => {
    const h = hostRef.current;
    if (!h) return;
    type Listing = { projects: ProjectSummary[]; warnings: string[] };
    const choose = (list: ProjectSummary[]) =>
      setProjectId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list.find((p) => p.itemCount > 0)?.id ?? null)));
    const listKey = "projects:" + hk();
    const saved = cacheGet<Listing>(listKey);
    if (saved) {
      setProjects(saved.value.projects);
      setProjWarn(saved.value.warnings[0] ?? null);
      choose(saved.value.projects);
    }
    await track(async () => {
      try {
        const r = await h.callTool<Listing>("launchpad.projects", who());
        cacheSet(listKey, r);
        setProjects(r.projects);
        setProjWarn(r.warnings[0] ?? null);
        choose(r.projects);
      } catch (e) {
        setProjWarn((e as Error).message);
        setProjects((cur) => cur ?? []);
      }
    });
  }, [track]);

  useEffect(() => {
    if (tab === "projects" && host && projects === null) void loadProjects();
  }, [tab, host]);

  useEffect(() => {
    const h = hostRef.current;
    if (!projectId || !h || tab !== "projects") return;
    save("projectId", projectId);
    const key = `board:${hk()}:${projectId}`;
    const force = forceBoard.current;
    forceBoard.current = false;

    const saved = cacheGet<Board>(key);
    setBoardError(null);
    setBoard(saved?.value ?? null); // null → skeleton only for a project we've never loaded
    setBoardStaleAt(saved?.at ?? null);
    if (saved && !force && Date.now() - saved.at < 20_000) return; // fresh enough

    let cancelled = false;
    setBoardRefreshing(true);
    void track(() =>
      h
        .callTool<Board>("launchpad.board", { projectId, ...who() })
        .then((b) => {
          if (cancelled) return;
          cacheSet(key, b);
          setBoard(b);
          setBoardStaleAt(null);
        })
        .catch((e) => !cancelled && !saved && setBoardError((e as Error).message))
        .finally(() => !cancelled && setBoardRefreshing(false)),
    );
    return () => {
      cancelled = true;
      setBoardRefreshing(false);
    };
  }, [projectId, tab, host, nonce]);

  // Refresh keeps everything on screen and updates it in place.
  const refresh = () => {
    if (tab === "issues") return void runSearch({ ...params, after: null });
    forceBoard.current = true;
    void loadProjects();
    setNonce((n) => n + 1);
  };

  // Warm the detail panel when the pointer rests on a row, so opening it is instant.
  const hoverTimer = useRef<number | undefined>(undefined);
  const prefetch = (item: Item | null) => {
    window.clearTimeout(hoverTimer.current);
    if (!item || !item.repo || item.number == null || !hostRef.current) return;
    hoverTimer.current = window.setTimeout(() => {
      void fetchDetail(hostRef.current!, item.repo!, item.number!, who()).catch(() => undefined);
    }, 120);
  };

  // ---- launching
  const withDetail = async (items: Item[]): Promise<(Item | IssueDetail)[]> =>
    Promise.all(
      items.map(async (i) => {
        if (i.kind === "draft" || !i.repo || i.number == null) return i;
        try {
          return await fetchDetail(hostRef.current!, i.repo, i.number, who());
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
    await startPrompt(buildPrompt({ item: full, mode: modeFor(item), host: effHost, user: params.user }), describe(item));
  };

  const startMany = async () => {
    const items = [...checked.values()];
    setConfirming(false);
    const full = await withDetail(items);
    let sent = 0;
    for (const it of full) {
      try {
        const how = await hostRef.current!.startThread(buildPrompt({ item: it, mode: modeFor(it), host: effHost, user: params.user }));
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

  const attach = async (items: Attachment[], what: string) => {
    try {
      const how = await hostRef.current!.attach(items);
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
  return (
    <div class={`app ${focus ? "has-detail" : ""} ${host?.mode === "codex" ? "host-codex" : ""}`} style={{ "--detail-w": `${detailW}px` }}>
      <header class="topbar">
        <div class="brand"><Svg d="play" size={13} /> Issue Launchpad</div>
        <Segmented label="View" value={tab} onChange={changeTab} options={[{ id: "issues", label: "Issues" }, { id: "projects", label: "Projects" }]} />
        <div class="spacer" />
        {tab === "issues" && !fatal && (
          <div class="search">
            <Svg d="search" size={13} />
            <input id="search" placeholder="Search · try label:bug no:assignee   ( / )" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </div>
        )}
        <button class={cx("icon-btn", busy > 0 && "spin")} title={busy > 0 ? "Updating…" : "Refresh"} aria-label="Refresh" onClick={refresh}><Svg d="refresh" /></button>
        {host && (
          <AccountMenu
            viewer={viewer}
            hostInfo={hostInfo}
            customHosts={customHosts}
            current={{ host: effHost ?? "github.com", user: params.user }}
            warn={!!fatal}
            onSwitch={switchTo}
            onConnect={() => setConnectOpen(true)}
            onOpen={() => void refreshHosts()}
          />
        )}
        <div class={cx("progress", busy > 0 && "on")} role="progressbar" aria-label="Loading" aria-hidden={busy === 0} />
      </header>

      <main>
        {fatal && host ? (
          <section class="view fatal">
            <ConnectPanel key={effHost} host={effHost ?? "github.com"} api={api} app={host} onReady={reload} autoContinue />
          </section>
        ) : tab === "issues" ? (
          <IssuesView
            params={params} onParams={changeParams} page={page} refreshing={refreshing} loadingMore={loadingMore}
            dim={refreshing && pageKey !== searchKey(params)} staleAt={staleAt} error={page ? null : loadError}
            onRetry={() => runSearch({ ...params, after: null })} onHover={prefetch}
            onMore={() => page?.endCursor && runSearch({ ...params, after: page.endCursor }, true)}
            focusId={focus?.id ?? null} checked={new Set(checked.keys())} onFocus={setFocus} onCheck={toggleCheck}
            onQuickStart={quickStart} groupByRepo={groupByRepo} onGroup={(v) => { setGroupByRepo(v); save("groupByRepo", v); }}
            quickLabel={quickLabel}
          />
        ) : (
          <ProjectsView
            projects={projects} warning={projWarn} projectId={projectId} onProject={setProjectId}
            board={board} refreshing={boardRefreshing} staleAt={boardStaleAt} error={boardError} onHover={prefetch}
            groupBy={groupBy} onGroupBy={(g) => { setGroupBy(g); save("groupBy", g); }}
            focusId={focus?.id ?? null} checked={new Set(checked.keys())} onFocus={setFocus} onCheck={toggleCheck}
            onQuickStart={quickStart} quickLabel={quickLabel}
          />
        )}

        {focus && host && <Resizer width={detailW} onChange={setDetailW} onCommit={(w) => save("detailW", w)} />}
        {focus && host && (
          <Detail
            item={focus} host={host} who={{ host: params.host, user: params.user }} mode={mode}
            onMode={(m) => { setMode(m); save("mode", m); }}
            onClose={() => setFocus(null)} onStart={startPrompt} onAttach={(text, title) => attach([{ key: focus.id, title, text }], "the task")} onCopy={copy}
          />
        )}
      </main>

      {checked.size > 0 && (
        <div class="tray" role="region" aria-label="Selection">
          <b>{checked.size} selected</b>
          <button class="ghost" onClick={() => setChecked(new Map())}>Clear</button>
          <span class="spacer" />
          <button onClick={() => attach([...checked.values()].map((i) => ({ key: i.id, title: chipLabel(i), text: buildContext([i]) })), `${checked.size} items`)}>Add all to composer</button>
          {confirming ? (
            <button class="primary danger" onClick={startMany}>Confirm: start {checked.size} threads</button>
          ) : (
            <button class="primary" onClick={() => (checked.size === 1 ? startMany() : setConfirming(true))}>
              <Svg d="play" size={12} /> Start {checked.size} thread{checked.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {connectOpen && host && <ConnectDialog api={api} app={host} onUse={useHost} onClose={() => setConnectOpen(false)} />}

      {toast && <div class={`toast ${toast.tone}`} role="status">{toast.msg}</div>}
    </div>
  );
}
