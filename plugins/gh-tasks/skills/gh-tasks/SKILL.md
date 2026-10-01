---
name: gh-tasks
description: Browse GitHub issues and Projects with GitHub Tasks and start work on an issue.
---

# GitHub Tasks

Open the board from the sidebar (or `@GitHub Tasks`) to browse issues and GitHub Projects. The user starts tasks from the UI; the UI sends you a fully formed prompt.

When you are asked to work on an issue:

1. Call `gh_tasks.issue` with `repo` and `number` to read the full body, labels, linked PRs and recent comments, rather than guessing from the title.
2. Locate (or clone) the repository in the current workspace before editing anything.
3. Follow the mode named in the prompt: **plan** means propose a plan and wait for approval; **implement** means make the change on a new branch and open a PR that references the issue; **investigate** means report findings without editing.

Use `gh_tasks.search` to find issues by GitHub search syntax (for example `label:bug repo:owner/name`).
