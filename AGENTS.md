For sync ownership and conflict-handling policy, see [docs/github-sync-ownership-model.md](docs/github-sync-ownership-model.md).

## Remote Build Runner

Use the local build runner service at `http://host.docker.internal:38127`.

Send `POST /run` JSON with:
- `image`: Docker image to run
- `workdir`: absolute macOS host path to mount at `/workspace`
- `cmd`: command array to run in the container

For `workdir`, prefer env `TASK_WORSPACE_PATH` when available (fallback to `TASK_WORKSPACE_PATH`).

Example payload:

```json
{
  "image": "node:22",
  "workdir": "/absolute/path/to/repo",
  "cmd": ["npm", "test"]
}
```

Execution rules:
- Stream and relay logs live from the response.
- Always report the final `[exit]` line.
- Treat non-zero exit code as failure.
