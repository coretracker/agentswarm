# Terminology

The terms below come from current repository docs and code.

- Task: a unit of work created from scratch or imported from GitHub.
- Provider: the agent engine used for a task (`codex` or `claude`).
- Task workspace: the filesystem area where task changes are made.
- Ask task: read-focused task mode for question/answer style outputs.
- Build task: change-producing task mode for implementation work.
- Checkpoint / change proposal: a reviewable pending change snapshot.
- Postflight: optional automation that runs after a successful build task.
- Repository automations: rule-based creation of tasks from GitHub events.

## TODO
- TODO: Confirm final user-facing wording for “checkpoint” vs “change proposal” in product UI copy.
