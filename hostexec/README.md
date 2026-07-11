# Hostexec Daemon

Start this process on the host machine when Verft needs to expose selected host tools, such as `xcodebuild`, to agent containers.

```sh
npm run hostexec
```

Configuration is read from the repository `.env` file or the current process environment:

- `HOSTEXEC_HOST` defaults to `127.0.0.1`.
- `HOSTEXEC_PORT` defaults to `38128`.
- `HOSTEXEC_TOKEN` enables bearer-token checks when set.

For Docker containers on Linux to reach the daemon, bind it to the Docker bridge or all interfaces:

```sh
npm run hostexec -- --host 0.0.0.0
```

Verft autodetects the daemon at the default host URLs. Repository **Host Commands** in the UI decide which shims are mounted for each repository. If `HOSTEXEC_TOKEN` is set, enter `HOSTEXEC_TOKEN` as the bearer token env var name in Settings.
