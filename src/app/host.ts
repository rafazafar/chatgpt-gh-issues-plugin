import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";

/**
 * The only file that knows whether we're running inside Codex or in the
 * standalone dev preview (where tools are served over plain HTTP).
 */
export type Host = {
  mode: "codex" | "standalone";
  callTool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Start a brand-new thread with this prompt. Resolves to how it was delivered. */
  startThread(prompt: string): Promise<"sent" | "copied">;
  /**
   * Add titled attachments to the active composer. Attachments accumulate (the host replaces the
   * app's previous context on every update, so we resend the full set) and each shows as its own chip.
   */
  attach(items: Attachment[]): Promise<"attached" | "copied">;
  /** Copy to the system clipboard (never attaches anything to the conversation). */
  copyText(text: string): Promise<void>;
  openLink(url: string): void;
  canStartThreads: boolean;
};

export type Attachment = { key: string; title: string; text: string };

const SEND_TIMEOUT = 300_000;

/** An Error that remembers the server's error code (no_token, bad_token, …). */
const failure = (message: string, code?: string) => Object.assign(new Error(message), { code });

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export async function connectHost(): Promise<Host> {
  const embedded = window.parent !== window;

  if (!embedded) {
    const callTool = async <T,>(name: string, args: Record<string, unknown> = {}) => {
      const res = await fetch(`/api/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const json = await res.json();
      if (!res.ok) throw failure(json?.error?.message ?? `Request failed (${res.status})`, json?.error?.code);
      return json as T;
    };
    return {
      mode: "standalone",
      callTool,
      canStartThreads: true,
      async startThread(prompt) {
        console.info("[standalone] would start a new thread with:\n" + prompt);
        await copy(prompt);
        return "copied";
      },
      async attach(items) {
        await copy(items.map((i) => i.text).join("\n\n"));
        return "copied";
      },
      copyText: copy,
      openLink: (url) => window.open(url, "_blank", "noopener"),
    };
  }

  const app = new App({ name: "gh-tasks", version: "0.1.0" });
  const ext = new OpenAIExtensions(app);

  const applyContext = (ctx: ReturnType<App["getHostContext"]>) => {
    if (ctx?.theme != null) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables != null) applyHostStyleVariables(ctx.styles.variables);
  };
  const attached = new Map<string, Attachment>();
  app.addEventListener("hostcontextchanged", (ctx) => {
    applyContext(app.getHostContext());
    // Keep our list in sync when the user removes a chip from the composer.
    const update = ctx as Record<string, unknown>;
    if (!Object.hasOwn(update, "openai/modelContext")) return;
    const mc = update["openai/modelContext"] as { content?: { type: string; text?: string }[] } | null;
    if (mc == null) return attached.clear();
    const present = new Set((mc.content ?? []).map((c) => c.text));
    for (const [k, a] of attached) if (!present.has(a.text)) attached.delete(k);
  });
  await app.connect();
  applyContext(app.getHostContext());

  return {
    mode: "codex",
    get canStartThreads() {
      return ext.message != null;
    },
    async callTool<T,>(name: string, args: Record<string, unknown> = {}) {
      const res = await app.callServerTool({ name, arguments: args });
      const sc = res.structuredContent as { error?: { message: string; code?: string } } | undefined;
      if (res.isError) {
        const text = res.content?.find((c) => c.type === "text") as { text: string } | undefined;
        throw failure(sc?.error?.message ?? text?.text ?? "Tool call failed", sc?.error?.code);
      }
      return res.structuredContent as T;
    },
    async startThread(prompt) {
      if (!ext.message) {
        await copy(prompt);
        return "copied";
      }
      const reply = await ext.message.send(
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          _meta: { "openai/message": { target: "new" } },
        },
        { timeout: SEND_TIMEOUT },
      );
      if (reply?.isError) throw new Error("Codex declined to start the thread.");
      return "sent";
    },
    async attach(items) {
      if (!ext.modelContext) {
        await copy(items.map((i) => i.text).join("\n\n"));
        return "copied";
      }
      for (const i of items) attached.set(i.key, i);
      await ext.modelContext.update({
        content: [...attached.values()].map((a) => ({
          type: "text" as const,
          text: a.text,
          _meta: { "openai/title": a.title },
        })),
      });
      return "attached";
    },
    copyText: copy,
    openLink(url) {
      void app.openLink({ url }).catch(() => window.open(url, "_blank", "noopener"));
    },
  };
}
