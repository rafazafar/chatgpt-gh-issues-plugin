import * as gh from "./github.ts";
import { DEFAULT_SEARCH } from "../shared/types.ts";
import type { AppError, SearchParams } from "../shared/types.ts";

/** Transport-agnostic tool bodies, shared by the MCP server and the dev preview server. */

export function errorOf(e: unknown): AppError {
  if (e instanceof gh.GitHubError) return { code: e.code, message: e.message };
  return { code: "unknown", message: e instanceof Error ? e.message : String(e) };
}

/**
 * The entrypoint tool returns instantly so the UI can paint immediately; the app then loads its
 * data itself (showing saved results while it does) instead of waiting on GitHub here.
 */
export const open = async () => ({ ready: true });

export const viewer = () => gh.getViewer();
export const search = (p: SearchParams) => gh.searchItems({ ...DEFAULT_SEARCH, ...p });
export const projects = () => gh.listProjects();
export const board = (projectId: string) => gh.getBoard(projectId);
export const issue = (repo: string, number: number) => gh.getIssueDetail(repo, number);
