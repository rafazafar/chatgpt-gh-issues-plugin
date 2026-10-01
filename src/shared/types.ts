export type Viewer = {
  login: string;
  name: string | null;
  avatarUrl: string;
  orgs: string[];
};

export type Label = { name: string; color: string };
export type Person = { login: string; avatarUrl: string };

export type ItemKind = "issue" | "pr" | "draft";

/** One issue, pull request or draft card, normalised from GraphQL. */
export type Item = {
  id: string;
  kind: ItemKind;
  number: number | null;
  title: string;
  url: string | null;
  state: "OPEN" | "CLOSED" | "MERGED" | "DRAFT";
  repo: string | null; // owner/name
  author: string | null;
  labels: Label[];
  assignees: Person[];
  comments: number;
  milestone: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  excerpt: string;
  /** Project memberships (issue search results only). */
  projects: { title: string; number: number; status: string | null }[];
  /** Project field values (board items only), by field name. */
  fields: Record<string, string>;
};

export type Page<T> = {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
};

export type SearchParams = {
  scope: "involves" | "assigned" | "author" | "mentions" | "all";
  kind: "issue" | "pr" | "any";
  state: "open" | "closed" | "all";
  repo?: string;
  text?: string;
  labels?: string[];
  sort: "updated" | "created" | "comments";
  after?: string | null;
};

export type ProjectSummary = {
  id: string;
  number: number;
  title: string;
  url: string;
  owner: string;
  description: string;
  itemCount: number;
  updatedAt: string;
};

export type SelectOption = { id: string; name: string; color: string };
export type BoardField = { id: string; name: string; options: SelectOption[] };

export type Board = {
  project: ProjectSummary;
  /** Single-select fields usable for grouping (Status first). */
  groupFields: BoardField[];
  items: Item[];
  truncated: boolean;
};

export type Comment = { author: string; body: string; createdAt: string };

export type IssueDetail = Item & {
  body: string;
  linkedPrs: { number: number; title: string; url: string; state: string }[];
  recentComments: Comment[];
};

export type OpenResult = {
  viewer?: Viewer;
  issues?: Page<Item>;
  params?: SearchParams;
  error?: { code: "no_token" | "bad_token" | "network" | "unknown"; message: string };
};

export const DEFAULT_SEARCH: SearchParams = {
  scope: "involves",
  kind: "issue",
  state: "open",
  sort: "updated",
};
