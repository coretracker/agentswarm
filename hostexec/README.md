# Hostexec Daemon

Start this process on the host machine when AgentSwarm needs to expose selected host tools, such as `xcodebuild`, to agent containers.

```sh
npm run hostexec
```

Configuration is read from the repository `.env` file or the current process environment:

- `HOSTEXEC_HOST` defaults to `127.0.0.1`.
- `HOSTEXEC_PORT` defaults to `38128`.
- `HOSTEXEC_TOKEN` enables bearer-token checks when set.
- `HOSTEXEC_COMMANDS` is a comma or whitespace separated daemon allowlist. Leave it empty to allow all valid command names; repository **Host Commands** in the UI still decide which shims are mounted for each repository.

For Docker Desktop, use `http://host.docker.internal:38128` in **Settings -> Hostexec**. If `HOSTEXEC_TOKEN` is set, enter `HOSTEXEC_TOKEN` as the bearer token env var name in Settings.
