import * as gh from "./github.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";
import type { OpenResult, SearchParams } from "../shared/types.ts";

/** Transport-agnostic tool bodies, shared by the MCP server and the dev preview server. */

export function errorOf(e: unknown): NonNullable<OpenResult["error"]> {
  if (e instanceof gh.GitHubError) return { code: e.code, message: e.message };
  return { code: "unknown", message: e instanceof Error ? e.message : String(e) };
}

export async function open(args: Partial<SearchParams> = {}): Promise<OpenResult> {
  const params: SearchParams = { ...DEFAULT_SEARCH, ...args, after: null };
  try {
    const [viewer, issues] = await Promise.all([gh.getViewer(), gh.searchItems(params)]);
    return { viewer, issues, params };
  } catch (e) {
    return { error: errorOf(e) };
  }
}

export const search = (p: SearchParams) => gh.searchItems({ ...DEFAULT_SEARCH, ...p });
export const projects = () => gh.listProjects();
export const board = (projectId: string) => gh.getBoard(projectId);
export const issue = (repo: string, number: number) => gh.getIssueDetail(repo, number);
