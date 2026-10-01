import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { OpenResult } from "../shared/types.ts";

/**
 * The only file that knows whether we're running inside Codex or in the
 * standalone dev preview (where tools are served over plain HTTP).
 */
export type Host = {
  mode: "codex" | "standalone";
  callTool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Start a brand-new thread with this prompt. Resolves to how it was delivered. */
  startThread(prompt: string): Promise<"sent" | "copied">;
  /** Attach text to the active composer as model context. */
  attachContext(text: string): Promise<"attached" | "copied">;
  /** Copy to the system clipboard (never attaches anything to the conversation). */
  copyText(text: string): Promise<void>;
  openLink(url: string): void;
  canStartThreads: boolean;
};

const SEND_TIMEOUT = 300_000;

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

export async function connectHost(onInitial: (r: OpenResult) => void): Promise<Host> {
  const embedded = window.parent !== window;

  if (!embedded) {
    const callTool = async <T,>(name: string, args: Record<string, unknown> = {}) => {
      const res = await fetch(`/api/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
      return json as T;
    };
    queueMicrotask(async () => onInitial(await callTool<OpenResult>("launchpad.open")));
    return {
      mode: "standalone",
      callTool,
      canStartThreads: true,
      async startThread(prompt) {
        console.info("[standalone] would start a new thread with:\n" + prompt);
        await copy(prompt);
        return "copied";
      },
      async attachContext(text) {
        await copy(text);
        return "copied";
      },
      copyText: copy,
      openLink: (url) => window.open(url, "_blank", "noopener"),
    };
  }

  const app = new App({ name: "issue-launchpad", version: "0.1.0" });
  const ext = new OpenAIExtensions(app);

  const applyContext = (ctx: ReturnType<App["getHostContext"]>) => {
    if (ctx?.theme != null) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables != null) applyHostStyleVariables(ctx.styles.variables);
  };
  app.addEventListener("hostcontextchanged", applyContext);
  // Register before connect so the initial tool result is not missed.
  app.ontoolresult = (result) => {
    const data = result.structuredContent as OpenResult | undefined;
    if (data) onInitial(data);
  };
  await app.connect();
  applyContext(app.getHostContext());

  return {
    mode: "codex",
    get canStartThreads() {
      return ext.message != null;
    },
    async callTool<T,>(name: string, args: Record<string, unknown> = {}) {
      const res = await app.callServerTool({ name, arguments: args });
      const sc = res.structuredContent as { error?: { message: string } } | undefined;
      if (res.isError) {
        const text = res.content?.find((c) => c.type === "text") as { text: string } | undefined;
        throw new Error(sc?.error?.message ?? text?.text ?? "Tool call failed");
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
    async attachContext(text) {
      if (!ext.modelContext) {
        await copy(text);
        return "copied";
      }
      await ext.modelContext.update({ content: [{ type: "text", text }] });
      return "attached";
    },
    copyText: copy,
    openLink(url) {
      void app.openLink({ url }).catch(() => window.open(url, "_blank", "noopener"));
    },
  };
}
