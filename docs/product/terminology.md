# Terminology

The terms below come from current repository docs and code.

- Task: a unit of work created against a repository.
- Task draft: a saved task definition that can be edited before it becomes a runnable task.
- Task board: the Kanban view that shows task drafts alongside active task workflow states.
- Provider: the agent engine used for a task (`codex` or `claude`).
- Task workspace: the filesystem area where task changes are made.
- Ask task: read-focused task mode for question/answer style outputs.
- Build task: change-producing task mode for implementation work.
- Checkpoint / change proposal: a reviewable pending change snapshot.
- Postflight: optional automation that runs after a successful build task.
- Repository environment variable: non-sensitive key/value configuration passed into repository task runtimes.
- Repository environment secret: write-only sensitive value stored per repository and exposed only as “configured” in UI/API reads.
- Repository MCP server: repository-scoped tool server configuration passed only to task runs and interactive terminals for that repository.

## TODO
- TODO: Confirm final user-facing wording for “checkpoint” vs “change proposal” in product UI copy.
