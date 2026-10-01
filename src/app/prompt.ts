import type { Item, IssueDetail } from "../shared/types.ts";

export type Mode = "plan" | "implement" | "investigate" | "review";

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "plan", label: "Plan first", hint: "Explore the code and propose a plan. Wait for approval before editing." },
  { id: "implement", label: "Implement", hint: "Branch, make the change, run tests, open a PR that closes the issue." },
  { id: "investigate", label: "Investigate", hint: "Find the root cause and report. No edits." },
  { id: "review", label: "Review", hint: "Review this pull request and summarise risks." },
];

export const defaultMode = (item: Pick<Item, "kind">): Mode => (item.kind === "pr" ? "review" : "plan");

export const modesFor = (item: Pick<Item, "kind">) =>
  item.kind === "pr" ? MODES.filter((m) => m.id === "review" || m.id === "investigate") : MODES.filter((m) => m.id !== "review");

const INSTRUCTIONS: Record<Mode, string[]> = {
  plan: [
    "Read the issue and any linked context, then explore the relevant code.",
    "Propose a concrete plan: files to change, approach, risks, and how you'll verify it.",
    "Stop and wait for my approval before making any edits.",
  ],
  implement: [
    "Read the issue, then explore the relevant code.",
    "Create a new branch, implement the change, and add or update tests.",
    "Run the project's checks and fix failures.",
    "Open a pull request that references the issue (e.g. \"Closes #N\") and summarise what changed.",
  ],
  investigate: [
    "Read the issue and reproduce or trace the problem in the code.",
    "Report the root cause, affected code, and your recommended fix.",
    "Do not edit any files.",
  ],
  review: [
    "Read the pull request description and diff.",
    "Review for correctness, regressions, missing tests and unclear design.",
    "Report findings ordered by severity. Do not push changes.",
  ],
};

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + "\n… (truncated; call gh_tasks.issue for the full text)" : s);

export type PromptInput = {
  item: Item | IssueDetail;
  mode: Mode;
  notes?: string;
  /** GitHub instance; only mentioned for non-github.com hosts. */
  host?: string;
  /** A specifically chosen account (not just the CLI's active one). */
  user?: string;
};

/** The thread opener Codex receives. Plain text so it's readable and editable in the composer. */
export function buildPrompt({ item, mode, notes, host, user }: PromptInput): string {
  const enterprise = host && host !== "github.com" ? host : null;
  const detail = item as Partial<IssueDetail>;
  const noun = item.kind === "pr" ? "pull request" : item.kind === "draft" ? "draft project card" : "issue";
  const ref = item.repo && item.number != null ? `${item.repo}#${item.number}` : item.title;
  const lines: string[] = [];

  lines.push(`${mode === "review" ? "Review" : "Work on"} GitHub ${noun} ${ref}: ${item.title}`);
  if (item.url) lines.push(item.url);
  if (enterprise) lines.push(`GitHub host: ${enterprise} (GitHub Enterprise; set GH_HOST=${enterprise} when using the gh CLI)`);
  if (user) lines.push(`GitHub account: @${user} (if the gh CLI is signed in as someone else, run \`gh auth switch --hostname ${host ?? "github.com"} --user ${user}\`)`);
  lines.push("");
  lines.push(`Mode: ${MODES.find((m) => m.id === mode)!.label}`);
  INSTRUCTIONS[mode].forEach((s, i) => lines.push(`${i + 1}. ${s}`));

  const ctx: string[] = [];
  if (item.labels.length) ctx.push(`Labels: ${item.labels.map((l) => l.name).join(", ")}`);
  if (item.assignees.length) ctx.push(`Assignees: ${item.assignees.map((a) => "@" + a.login).join(", ")}`);
  for (const p of item.projects) ctx.push(`Project: ${p.title}${p.status ? ` › ${p.status}` : ""}`);
  for (const [k, v] of Object.entries(item.fields))
    if (!["Title", "Assignees", "Labels"].includes(k)) ctx.push(`${k}: ${v}`);
  if (item.milestone) ctx.push(`Milestone: ${item.milestone}`);
  if (detail.linkedPrs?.length) ctx.push(`Linked PRs: ${detail.linkedPrs.map((p) => `#${p.number} (${p.state})`).join(", ")}`);
  if (ctx.length) lines.push("", "Context", ...ctx.map((c) => `- ${c}`));

  if (item.kind === "draft") {
    lines.push("", "This is a draft card with no repository yet. Ask me which repository it belongs to before starting.");
  } else if (item.repo) {
    lines.push(
      "",
      `Repository: ${item.repo}. If the current workspace is not a checkout of it, find or clone it first.`,
      `Use the gh_tasks.issue tool (repo: "${item.repo}", number: ${item.number}${enterprise ? `, host: "${enterprise}"` : ""}${user ? `, user: "${user}"` : ""}) for the full text and comments.`,
    );
  }

  const body = (detail.body ?? "").trim();
  if (body) lines.push("", "Description", ...trim(body, 3500).split("\n").map((l) => `> ${l}`));

  if (notes?.trim()) lines.push("", "Additional instructions", notes.trim());
  return lines.join("\n");
}

/** Compact reference used when attaching several items as context. */
export function buildContext(items: Item[]): string {
  return items
    .map((i) => `- ${i.repo ?? "draft"}${i.number != null ? "#" + i.number : ""} [${i.state}] ${i.title}${i.url ? " — " + i.url : ""}`)
    .join("\n");
}
