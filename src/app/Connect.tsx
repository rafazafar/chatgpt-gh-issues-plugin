import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { HostCheck } from "../shared/types.ts";
import type { Host } from "./host.ts";
import { Spinner, Svg } from "./ui.tsx";
import { cx, normHost } from "./util.ts";

type Api = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;

function CommandBox({ cmd, host }: { cmd: string; host: Host }) {
  const [done, setDone] = useState(false);
  return (
    <div class="cmd">
      {/* Each token is unbreakable so the line can only wrap at spaces, never inside a --flag. */}
      <code>{cmd.split(" ").flatMap((t, i) => (i ? [" ", <span class="tok" key={i}>{t}</span>] : [<span class="tok" key={i}>{t}</span>]))}</code>
      <button
        class="ghost"
        onClick={async () => {
          await host.copyText(cmd).catch(() => undefined);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        }}
      >
        {done ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

const loginCmd = (h: string) => `gh auth login --hostname ${h} --git-protocol ssh --skip-ssh-key --web --clipboard --scopes project`;
const tokenCmd = (h: string) => `pbpaste | gh auth login --hostname ${h} --git-protocol ssh --skip-ssh-key --with-token`;
const refreshCmd = (h: string) => `gh auth refresh --hostname ${h} --scopes project`;

type PanelProps = {
  host: string;
  api: Api;
  app: Host;
  /** Called when the host is usable. With autoContinue it fires by itself. */
  onReady: (host: string) => void;
  autoContinue?: boolean;
};

/**
 * Explains, for one host, exactly what's missing and how to fix it, then re-checks automatically
 * when the user comes back from the terminal. Never asks for a token.
 */
export function ConnectPanel({ host, api, app, onReady, autoContinue }: PanelProps) {
  const [res, setRes] = useState<HostCheck | null>(null);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);

  const check = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await api<HostCheck>("launchpad.checkHost", { host });
      if (mine === seq.current) setRes(r);
    } catch (e) {
      if (mine === seq.current) setRes({ host, state: "unreachable", ghInstalled: true, message: (e as Error).message });
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [host, api]);

  useEffect(() => {
    setRes(null);
    void check();
  }, [host]);

  // Back from the terminal? Look again without making the user click.
  useEffect(() => {
    const again = () => res && res.state !== "ready" && !busy && void check();
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [res?.state, busy, check]);

  useEffect(() => {
    if (autoContinue && res?.state === "ready") onReady(host);
  }, [res?.state]);

  if (!res)
    return (
      <div class="connect">
        <p class="checking"><Spinner /> Checking {host}…</p>
      </div>
    );

  const again = (
    <div class="actions">
      <button class="primary" disabled={busy} onClick={check}>{busy ? <><Spinner /> Checking…</> : "Check again"}</button>
      <small>Checked automatically when you come back to this window.</small>
    </div>
  );

  if (res.state === "ready")
    return (
      <div class="connect">
        <h3 class="ok">✓ Connected to {host}</h3>
        <p>Signed in as <b>{res.login}</b>.</p>
        {!autoContinue && <button class="primary" onClick={() => onReady(host)}>Use {host}</button>}
      </div>
    );

  if (res.state === "unreachable")
    return (
      <div class="connect">
        <h3>Can't reach {host}</h3>
        <p>Company GitHub servers are often only reachable on the office network or VPN. Connect, then check again.</p>
        {res.message && <p class="detail-msg">{res.message}</p>}
        {again}
      </div>
    );

  if (res.state === "not_github")
    return (
      <div class="connect">
        <h3>{host} doesn't look like GitHub</h3>
        <p>Use just the hostname, for example <code>github.mycompany.com</code> (no <code>https://</code>, no path), and check the spelling.</p>
        {again}
      </div>
    );

  if (res.state === "bad_token")
    return (
      <div class="connect">
        <h3>Sign-in for {host} no longer works</h3>
        <p>The saved login was rejected. It may have expired, or your organisation needs it authorised for SSO.</p>
        <ol class="steps">
          <li><b>Refresh it</b> in a terminal<CommandBox cmd={refreshCmd(host)} host={app} /></li>
          <li><small>Still rejected? Sign in again with <code>{loginCmd(host)}</code></small></li>
        </ol>
        {again}
      </div>
    );

  // no_token: the SSH-only case
  return (
    <div class="connect">
      <h3>Sign in to {host}</h3>
      <p class="lead">
        Issues and Projects come from GitHub's API, which needs a sign-in token. Your SSH key only covers git
        (clone and push), so it can't be used here. The two work side by side: <b>your git + SSH setup stays exactly as it is.</b>
      </p>
      <ol class="steps">
        {!res.ghInstalled && (
          <li>
            <b>Install the GitHub CLI</b> (one time)
            <CommandBox cmd="brew install gh" host={app} />
            <small>or download it from <a href="https://cli.github.com" data-ext onClick={(e) => (e.preventDefault(), app.openLink("https://cli.github.com"))}>cli.github.com</a></small>
          </li>
        )}
        <li>
          <b>Sign in</b> in a terminal
          <CommandBox cmd={loginCmd(host)} host={app} />
          <small>It opens your browser, where you choose your company account. Your SSH keys aren't touched.</small>
        </li>
      </ol>
      <details class="alt">
        <summary>Browser sign-in blocked by your company?</summary>
        <p>Use a personal access token instead.</p>
        <ol class="steps">
          <li>
            Create a <b>classic</b> token with <code>repo</code>, <code>read:org</code> and <code>project</code> scopes at{" "}
            <a href={`https://${host}/settings/tokens`} onClick={(e) => (e.preventDefault(), app.openLink(`https://${host}/settings/tokens`))}>{host}/settings/tokens</a>,
            and authorise it for SSO if prompted. Copy it.
          </li>
          <li>Then run (macOS; reads the token from your clipboard)<CommandBox cmd={tokenCmd(host)} host={app} /></li>
        </ol>
        <p><small>If neither works, your organisation may restrict API access. Ask your GitHub admin to allow the GitHub CLI app or personal access tokens.</small></p>
      </details>
      {again}
    </div>
  );
}

type DialogProps = {
  api: Api;
  app: Host;
  onUse: (host: string) => void;
  onClose: () => void;
  initialHost?: string;
};

/** "Connect a GitHub host": type a host (or pick a detected one), then follow the guided panel. */
export function ConnectDialog({ api, app, onUse, onClose, initialHost }: DialogProps) {
  const [input, setInput] = useState(initialHost ?? "");
  const [host, setHost] = useState<string | null>(initialHost ? normHost(initialHost) : null);
  const [found, setFound] = useState<string[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (h: string) => {
    const n = normHost(h);
    setInput(n);
    setHost(n);
  };

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Connect a GitHub host">
        <header>
          <h2>Connect a GitHub host</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}><Svg d="close" /></button>
        </header>
        <form class="host-form" onSubmit={(e) => (e.preventDefault(), input.trim() && submit(input))}>
          <input
            autoFocus
            placeholder="github.mycompany.com"
            value={input}
            spellcheck={false}
            onInput={(e) => (setInput((e.target as HTMLInputElement).value), setHost(null))}
          />
          <button class="primary" type="submit" disabled={!input.trim()}>Check</button>
        </form>
        {!host && (
          <div class="detect">
            {found === null ? (
              <button
                class="ghost link"
                disabled={detecting}
                title="Reads hostnames (only) from ~/.ssh/config"
                onClick={async () => {
                  setDetecting(true);
                  try {
                    setFound((await api<{ hosts: string[] }>("launchpad.suggestHosts")).hosts);
                  } catch {
                    setFound([]);
                  } finally {
                    setDetecting(false);
                  }
                }}
              >
                {detecting ? "Looking…" : "Detect from my SSH config"}
              </button>
            ) : found.length ? (
              <>
                <small>Found in your SSH config:</small>
                <div class="chip-row">
                  {found.map((h) => <button key={h} class="chip" onClick={() => submit(h)}>{h}</button>)}
                </div>
              </>
            ) : (
              <small class="muted">No other hosts found in your SSH config. Type the hostname above.</small>
            )}
            <p class="muted tiny">Work on a company GitHub over SSH? Enter its hostname, the part after <code>git@</code> in your repo URLs.</p>
          </div>
        )}
        {host && <ConnectPanel key={host} host={host} api={api} app={app} onReady={onUse} />}
      </div>
    </div>
  );
}

/** Header control: current host, the others you can switch to, and "Connect another…". */
export function HostMenu({ current, hosts, warn, onSwitch, onConnect }: { current: string; hosts: string[]; warn?: boolean; onSwitch: (h: string) => void; onConnect: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), window.removeEventListener("keydown", esc));
  }, [open]);
  const all = [...new Set([current, ...hosts])];
  return (
    <div class="host-menu" ref={ref}>
      <button class={cx("host-btn", open && "open", warn && "warn")} aria-haspopup="menu" aria-expanded={open} title="GitHub host" onClick={() => setOpen((o) => !o)}>
        <span class="dot" />{current}<span class="caret">▾</span>
      </button>
      {open && (
        <div class="menu" role="menu">
          {all.map((h) => (
            <button key={h} role="menuitemradio" aria-checked={h === current} class={cx("item", h === current && "on")} onClick={() => (setOpen(false), h !== current && onSwitch(h))}>
              <span class="tick">{h === current ? "✓" : ""}</span>{h}
            </button>
          ))}
          <hr />
          <button role="menuitem" class="item" onClick={() => (setOpen(false), onConnect())}>
            <span class="tick">＋</span>Connect another GitHub host…
          </button>
        </div>
      )}
    </div>
  );
}
