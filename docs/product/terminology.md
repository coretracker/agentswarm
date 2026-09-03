# Terminology

The terms below come from current repository docs and code.

- Task: a unit of work created against a repository.
- Team: an optional group of users used only to share an owner's opted-in tasks with current members; teams do not grant roles or permissions.
- Share with team: an owner- or administrator-controlled task setting. It is private by default and grants eligible current teammates visibility only when they also have repository access and the required user-level task permissions.
- Task draft: a saved task definition that can be edited before it becomes a runnable task.
- Provider: the agent engine used for a task (`codex` or `claude`).
- Task workspace: the filesystem area where task changes are made.
- Ask task: read-focused task mode for question/answer style outputs.
- Build task: change-producing task mode for implementation work.
- Checkpoint / change proposal: a reviewable pending change snapshot.
- Postflight: optional automation that runs after a successful build task.
- Repository environment variable: non-sensitive key/value configuration passed into repository task runtimes.
- Repository environment secret: write-only sensitive value stored per repository and exposed only as “configured” in UI/API reads.

## TODO
- TODO: Confirm final user-facing wording for “checkpoint” vs “change proposal” in product UI copy.
