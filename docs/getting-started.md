# Getting Started

This guide covers the first-time setup for AgentSwarm.

## 1. What You Need

Before you begin, make sure you have:

- Docker
- Docker Compose
- A GitHub token
- An OpenAI API key
- Optional: an Anthropic API key if you plan to use Claude tasks

The first admin login comes from `.env.example` unless you change it.

## 2. Start AgentSwarm

Run the setup command once before the first start:

```bash
./agentswarm.sh init
```

Then start the app:

```bash
./agentswarm.sh start
```

If you need to rebuild the images later, use:

```bash
./agentswarm.sh rebuild
```

To stop the stack:

```bash
./agentswarm.sh stop
```

When the app is running, open:

- `http://localhost:3217/login`

## 3. Add Credentials

After you log in, open **Settings** and add the credentials AgentSwarm needs for the providers you want to use.

- GitHub token for GitHub access, imports, and repository operations
- OpenAI API key for Codex tasks
- Anthropic API key for Claude tasks

Save the settings after adding them. The UI shows which credentials are already configured.

## 4. Add Repositories

Open **Repositories** and add the repositories you want AgentSwarm to manage.

1. Open the Repositories page
2. Add the repository URL
3. Set the default branch if needed
4. Save the repository

After this, the repository is available when you create tasks or import work from GitHub.

## 5. Next Steps

Once setup is complete, you can:

- create a task from scratch
- import a task from a GitHub issue
- import a task from a pull request
- run Codex or Claude tasks on a connected repository
