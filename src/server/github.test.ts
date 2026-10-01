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

// ------------------------------------------------------------ GitHub Enterprise
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { graphqlUrl, listHosts, normalizeHost, parseHostsYml, searchItems } from "./github.ts";

const ENV_KEYS = ["GITHUB_TOKEN", "GH_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST", "GH_CONFIG_DIR"];
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.entries(vars).forEach(([k, v]) => v !== undefined && (process.env[k] = v));
  try {
    await fn();
  } finally {
    ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  }
}

test("normalizeHost strips scheme/path/case and defaults to github.com", () => {
  assert.equal(normalizeHost("https://GHE.Corp.com/"), "ghe.corp.com");
  assert.equal(normalizeHost("ghe.corp.com/api/v3"), "ghe.corp.com");
  assert.equal(normalizeHost(""), "github.com");
  assert.equal(normalizeHost(undefined), "github.com");
});

test("GraphQL endpoint per GitHub flavour", () => {
  assert.equal(graphqlUrl("github.com"), "https://api.github.com/graphql");
  assert.equal(graphqlUrl("ghe.corp.com"), "https://ghe.corp.com/api/graphql"); // Enterprise Server
  assert.equal(graphqlUrl("acme.ghe.com"), "https://api.acme.ghe.com/graphql"); // data residency cloud
});

test("hosts.yml: only unindented keys are hosts", () => {
  const yml = "github.com:\n    users:\n        me:\n    user: me\nghe.corp.com:\n    user: me2\n    git_protocol: https\n";
  assert.deepEqual(parseHostsYml(yml), ["github.com", "ghe.corp.com"]);
});

test("an Enterprise-only login defaults to that host; both logins default to github.com unless GH_HOST", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-"));
  await writeFile(path.join(dir, "hosts.yml"), "ghe.corp.com:\n    user: me\n");
  await withEnv({ GH_CONFIG_DIR: dir }, async () => {
    assert.deepEqual(await listHosts(), { hosts: ["ghe.corp.com"], default: "ghe.corp.com" });
  });
  await writeFile(path.join(dir, "hosts.yml"), "github.com:\n    user: me\nghe.corp.com:\n    user: me2\n");
  await withEnv({ GH_CONFIG_DIR: dir }, async () => {
    const r = await listHosts();
    assert.deepEqual(r.hosts.sort(), ["ghe.corp.com", "github.com"]);
    assert.equal(r.default, "github.com");
  });
  await withEnv({ GH_CONFIG_DIR: dir, GH_HOST: "ghe.corp.com" }, async () => {
    assert.equal((await listHosts()).default, "ghe.corp.com");
  });
});

const emptySearch = { search: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("Enterprise requests go to the Enterprise endpoint with the Enterprise token only", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return reply({ data: emptySearch });
  }) as typeof fetch;
  try {
    await withEnv({ GITHUB_TOKEN: "ghp_dotcom_secret", GH_ENTERPRISE_TOKEN: "ghe_corp_secret" }, async () => {
      await searchItems({ ...DEFAULT_SEARCH, host: "ghe.corp.com" });
      await searchItems({ ...DEFAULT_SEARCH });
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls[0].url, "https://ghe.corp.com/api/graphql");
  assert.equal(calls[0].auth, "bearer ghe_corp_secret");
  assert.equal(calls[1].url, "https://api.github.com/graphql");
  assert.equal(calls[1].auth, "bearer ghp_dotcom_secret");
  assert.ok(!calls.some((c) => c.url.includes("ghe.corp.com") && c.auth?.includes("dotcom")), "github.com token must never reach an Enterprise host");
});

test("an older server without project fields still lists issues (retries without them)", async () => {
  const queries: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query as string;
    queries.push(q);
    return queries.length === 1
      ? reply({ errors: [{ message: "Field 'projectItems' doesn't exist on type 'Issue'" }] })
      : reply({ data: emptySearch });
  }) as typeof fetch;
  try {
    await withEnv({ GH_ENTERPRISE_TOKEN: "x" }, async () => {
      const page = await searchItems({ ...DEFAULT_SEARCH, host: "old.ghes.corp" });
      assert.equal(page.totalCount, 0);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(queries.length, 2);
  assert.match(queries[0], /projectItems/);
  assert.doesNotMatch(queries[1], /projectItems/);
});

// ------------------------------------------------------ connecting a host (SSH-only users)
import { checkHost, parseSshConfigHosts, suggestHosts } from "./github.ts";

test("ssh config: pulls real hostnames, skips wildcards, IPs and bare aliases", () => {
  const cfg = `
Host *
  ServerAliveInterval 30
Host work
  HostName github.axa-corp.co.jp   # AXA
  User git
Host gh-personal github.com
  IdentityFile ~/.ssh/id_ed25519
Host 10.1.2.3 build-box
Host !internal *.corp
`;
  assert.deepEqual(parseSshConfigHosts(cfg).sort(), ["github.axa-corp.co.jp", "github.com"]);
});

test("suggestHosts excludes github.com, other forges and hosts already signed in", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ssh-"));
  const file = path.join(dir, "config");
  await writeFile(file, "Host a\n HostName github.com\nHost b\n HostName gitlab.com\nHost c\n HostName git.example.co.jp\n");
  await withEnv({ GH_CONFIG_DIR: dir }, async () => {
    assert.deepEqual(await suggestHosts(file), ["git.example.co.jp"]);
  });
});

const stubFetch = (handler: (body: string) => Response | Promise<Response>) => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init?: RequestInit) => handler(String(init?.body ?? ""))) as typeof fetch;
  return () => (globalThis.fetch = real);
};
const unauth = () => new Response(JSON.stringify({ message: "Requires authentication" }), { status: 401 });
const viewerReply = () => reply({ data: { viewer: { login: "taro", name: null, avatarUrl: "", organizations: { nodes: [] } } } });

test("checkHost: unreachable host (VPN down) is reported as such, before any login advice", async () => {
  const restore = stubFetch(() => { throw new TypeError("getaddrinfo ENOTFOUND ghe.axa.example"); });
  try {
    const r = await checkHost("ghe.axa.example");
    assert.equal(r.state, "unreachable");
    assert.match(r.message ?? "", /ENOTFOUND/);
  } finally { restore(); }
});

test("checkHost: a web server that isn't GitHub is not_github", async () => {
  const restore = stubFetch(() => new Response("<html>Not found</html>", { status: 404 }));
  try { assert.equal((await checkHost("intranet.example")).state, "not_github"); } finally { restore(); }
});

test("checkHost: reachable GitHub but no login → no_token with host-specific advice", async () => {
  const restore = stubFetch(unauth);
  try {
    await withEnv({}, async () => {
      const r = await checkHost("ghe.axa.example");
      assert.equal(r.state, "no_token");
      assert.match(r.message ?? "", /gh auth login --hostname ghe\.axa\.example/);
    });
  } finally { restore(); }
});

test("checkHost: working credential → ready with the account name", async () => {
  const restore = stubFetch((body) => (body.includes("__typename }") ? unauth() : viewerReply()));
  try {
    await withEnv({ GH_ENTERPRISE_TOKEN: "t" }, async () => {
      const r = await checkHost("ghe.axa.example");
      assert.equal(r.state, "ready");
      assert.equal(r.login, "taro");
    });
  } finally { restore(); }
});

test("checkHost: rejected credential → bad_token", async () => {
  const restore = stubFetch(unauth); // probe 401 (fine) and the authenticated call 401 (rejected)
  try {
    await withEnv({ GH_ENTERPRISE_TOKEN: "expired" }, async () => {
      assert.equal((await checkHost("ghe.axa.example")).state, "bad_token");
    });
  } finally { restore(); }
});
