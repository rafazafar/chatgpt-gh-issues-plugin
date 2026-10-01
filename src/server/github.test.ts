import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchQuery } from "./github.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";

test("default query is open issues involving me, newest first", () => {
  assert.equal(
    buildSearchQuery(DEFAULT_SEARCH),
    "is:issue is:open archived:false involves:@me sort:updated-desc",
  );
});

test("repo filter replaces the scope qualifier", () => {
  const q = buildSearchQuery({ ...DEFAULT_SEARCH, repo: "a/b", scope: "assigned" });
  assert.match(q, /repo:a\/b/);
  assert.doesNotMatch(q, /assignee:@me/);
});

test("labels are quoted and free text is appended", () => {
  const q = buildSearchQuery({ ...DEFAULT_SEARCH, labels: ["good first issue"], text: "crash" });
  assert.match(q, /label:"good first issue"/);
  assert.match(q, /crash sort:/);
});

test("kind=any and state=all drop their qualifiers", () => {
  const q = buildSearchQuery({ ...DEFAULT_SEARCH, kind: "any", state: "all" });
  assert.doesNotMatch(q, /is:issue|is:pr|is:open|is:closed/);
});
