# Getting Started

This guide walks through the first-time setup for AgentSwarm.

## Prerequisites

Before you start, make sure you have:

- Docker
- Docker Compose
- A GitHub account and token
- An OpenAI API key
- Optional: an Anthropic API key if you plan to use Claude tasks

## Credentials Needed

AgentSwarm uses a few different credentials depending on what you want to do:

- GitHub token: used to connect GitHub and work with repositories, issues, and pull requests
- OpenAI API key: used for Codex-based tasks
- Anthropic API key: used for Claude-based tasks
- First admin login: the default admin account comes from `.env.example` unless you change it

The app stores provider credentials in the Settings UI rather than in `.env`.

## Initialize the Stack

Before the first run, initialize the stack and runtime images:

```bash
./agentswarm.sh init
```

This is the recommended first command for a fresh setup.

## Start AgentSwarm

After initialization, start the application:

```bash
./agentswarm.sh start
```

If you need to rebuild images later, use:

```bash
./agentswarm.sh rebuild
```

To stop the stack:

```bash
./agentswarm.sh stop
```

Once the app is running, open:

- `http://localhost:3217/login`

## Add Credentials

After logging in, go to Settings and add the credentials you need:

1. Add your GitHub token
2. Add your OpenAI API key
3. Add your Anthropic API key if you want Claude support
4. Save the settings

The UI will show whether each credential is configured.

## Add Repositories

Once credentials are in place, go to Repositories and add the repos you want AgentSwarm to manage:

1. Open the Repositories page
2. Add the repository URL
3. Set the default branch if needed
4. Save the repository

After that, the repository will be available when creating tasks.

## Next Steps

After setup, you can:

- create a task from scratch
- import a task from a GitHub issue
- import a task from a pull request
- run Codex or Claude tasks on a connected repository
