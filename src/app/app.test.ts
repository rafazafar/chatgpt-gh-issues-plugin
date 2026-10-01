import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.ts";
import { buildPrompt, defaultMode, modesFor } from "./prompt.ts";
import type { Item } from "../shared/types.ts";

const item: Item = {
  id: "1", kind: "issue", number: 7, title: "Crash on start", url: "https://github.com/a/b/issues/7",
  state: "OPEN", repo: "a/b", author: "me", labels: [{ name: "bug", color: "d73a4a" }],
  assignees: [{ login: "me", avatarUrl: "" }], comments: 0, milestone: null, createdAt: null, updatedAt: null,
  excerpt: "", projects: [{ title: "Board", number: 1, status: "Todo" }], fields: { Priority: "P1" },
};

test("markdown escapes HTML but keeps <br> as a line break", () => {
  const html = renderMarkdown("a<br>b <script>alert(1)</script>");
  assert.match(html, /a<br>b/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("markdown links only allow http(s)", () => {
  assert.doesNotMatch(renderMarkdown("[x](javascript:alert(1))"), /href="javascript/);
  assert.match(renderMarkdown("[x](https://e.com)"), /href="https:\/\/e\.com"/);
});

test("plan prompt asks for approval and carries repo + context", () => {
  const p = buildPrompt({ item, mode: "plan" });
  assert.match(p, /Work on GitHub issue a\/b#7: Crash on start/);
  assert.match(p, /wait for my approval/i);
  assert.match(p, /Project: Board › Todo/);
  assert.match(p, /Priority: P1/);
  assert.match(p, /launchpad\.issue tool \(repo: "a\/b", number: 7\)/);
});

test("implement prompt opens a PR; notes are appended", () => {
  const p = buildPrompt({ item, mode: "implement", notes: "Use pnpm." });
  assert.match(p, /Open a pull request/);
  assert.match(p, /Additional instructions\nUse pnpm\./);
});

test("PRs default to review and only offer review/investigate", () => {
  const pr = { ...item, kind: "pr" as const };
  assert.equal(defaultMode(pr), "review");
  assert.ok(modesFor(pr).some((m) => m.id === "review"));
  assert.ok(!modesFor(pr).some((m) => m.id === "implement"));
});

test("draft cards ask which repository", () => {
  const p = buildPrompt({ item: { ...item, kind: "draft", repo: null, number: null }, mode: "plan" });
  assert.match(p, /Ask me which repository/);
});
