import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { registerGitHubPrWebhookRoutes } from "./github-pr-webhooks.js";

const defaultSettingsStore = {
  getRuntimeCredentials: async () => ({
    githubToken: null
  })
};

const defaultSpawner = {
  prepareTaskWorkspaceOnly: async () => undefined
};

test("GitHub PR webhook queues linked PR comments", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const appendedMessages: unknown[] = [];
  const triggeredActions: unknown[] = [];
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1" }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => ({
        id: "task-1",
        executionStatus: "idle"
      }),
      listMessages: async () => [],
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-1",
          content: (input as { content: string }).content
        };
      },
      hasPendingChangeProposal: async () => false,
      getActiveInteractiveSession: async () => null
    } as never,
    scheduler: {
      triggerAction: async (...args: unknown[]) => {
        triggeredActions.push(args);
        return true;
      }
    } as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "Please add a regression test.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.equal(appendedMessages.length, 1);
  assert.deepEqual(appendedMessages[0], {
    role: "user",
    action: "build",
    queueState: "pending",
    queueSource: "github_pr",
    externalId: "github:pr_comment:1001",
    content:
      "A new GitHub pull request feedback item was added to linked PR #42.\n\nType: pr_comment\nAuthor: @alice\nURL: https://github.com/acme/repo/pull/42#issuecomment-1001\n\nFeedback:\nPlease add a regression test.\n\nIf the feedback is a question without a clear requested code or file change, reply on GitHub asking for confirmation or a follow-up before changing files.\n\nAfter handling this feedback, reply on GitHub at the URL above with a brief status."
  });
  assert.equal(triggeredActions.length, 1);
  assert.deepEqual(triggeredActions[0], ["task-1", "build", { content: (appendedMessages[0] as { content: string }).content }, { promptMessageId: "message-1" }]);

  await app.close();
});

test("GitHub PR webhook ignores configured integration bot login", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let lookupCount = 0;
  let appendCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1", githubIntegrationBotLogin: "coretracker" }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        lookupCount += 1;
        return null;
      },
      appendMessage: async () => {
        appendCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "Agent status reply.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "CoreTracker",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "ignored_bot_user" });
  assert.equal(lookupCount, 0);
  assert.equal(appendCount, 0);

  await app.close();
});

test("GitHub PR webhook ignores senders outside configured allowed users", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let lookupCount = 0;
  let appendCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1", githubPrAllowedUsers: ["alice"] }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        lookupCount += 1;
        return null;
      },
      appendMessage: async () => {
        appendCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "Please handle this.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "mallory",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "disallowed_github_user" });
  assert.equal(lookupCount, 0);
  assert.equal(appendCount, 0);

  await app.close();
});

test("GitHub PR webhook ignores empty feedback bodies", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let lookupCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1" }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        lookupCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "submitted",
    pull_request: {
      number: 42
    },
    review: {
      id: 2001,
      body: "   ",
      html_url: "https://github.com/acme/repo/pull/42#pullrequestreview-2001",
      state: "commented"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request_review",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "ignored_event" });
  assert.equal(lookupCount, 0);

  await app.close();
});

test("GitHub PR webhook ignores comments without required bot mention", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let lookupCount = 0;
  let appendCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "agentswarm-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        lookupCount += 1;
        return null;
      },
      appendMessage: async () => {
        appendCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "Please add a regression test.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "missing_bot_mention" });
  assert.equal(lookupCount, 0);
  assert.equal(appendCount, 0);

  await app.close();
});

test("GitHub PR webhook queues comments with required bot mention", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const appendedMessages: unknown[] = [];
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "agentswarm-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => ({
        id: "task-1",
        executionStatus: "queued"
      }),
      listMessages: async () => [],
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-1",
          content: (input as { content: string }).content
        };
      },
      hasPendingChangeProposal: async () => false
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "@AgentSwarm-Bot please add a regression test.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: true, taskId: "task-1", messageId: "message-1" });
  assert.equal(appendedMessages.length, 1);
  assert.match((appendedMessages[0] as { content: string }).content, /@AgentSwarm-Bot please add a regression test\./);

  await app.close();
});

test("GitHub PR webhook uses repository feedback instructions", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const appendedMessages: unknown[] = [];
  const secret = "webhook-secret";
  const customInstructions = "Custom repo instruction: reply with the final decision.";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1", githubPrFeedbackInstructions: customInstructions }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => ({
        id: "task-1",
        executionStatus: "queued"
      }),
      listMessages: async () => [],
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-1",
          content: (input as { content: string }).content
        };
      },
      hasPendingChangeProposal: async () => false
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "created",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "Please add a regression test.",
      html_url: "https://github.com/acme/repo/pull/42#issuecomment-1001"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.equal(appendedMessages.length, 1);
  assert.match((appendedMessages[0] as { content: string }).content, /Custom repo instruction/);
  assert.doesNotMatch((appendedMessages[0] as { content: string }).content, /If the feedback is a question without a clear requested code/);

  await app.close();
});

test("GitHub PR webhook creates build task on PR branch when mentioned without linked task", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  const createdTasks: unknown[] = [];
  const patches: unknown[] = [];
  const appendedMessages: unknown[] = [];
  const triggeredActions: unknown[] = [];

  const openedTask = {
    id: "task-created",
    executionStatus: "idle",
    taskType: "build"
  };

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        name: "repo",
        url: "https://github.com/acme/repo.git",
        defaultBranch: "main",
        githubIntegrationBotLogin: "agentswarm-bot",
        githubPrRequireBotMention: true,
        githubPrTaskOwnerUserId: "user-1"
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => null,
      createTask: async (input: unknown, _repository: unknown, ownerUserId: string) => {
        createdTasks.push({ input, ownerUserId });
        return {
          id: "task-created"
        };
      },
      patchTask: async (_taskId: string, patch: unknown) => {
        patches.push(patch);
        return openedTask;
      },
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-created",
          content: (input as { content: string }).content
        };
      },
      setExecutionState: async () => openedTask
    } as never,
    scheduler: {
      triggerAction: async (...args: unknown[]) => {
        triggeredActions.push(args);
        return true;
      }
    } as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "submitted",
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 42,
      head: {
        ref: "feature/pr-branch",
        repo: {
          full_name: "acme/repo"
        }
      }
    },
    review: {
      id: 2001,
      body: "@agentswarm-bot please fix the failing test.",
      html_url: "https://github.com/acme/repo/pull/42#pullrequestreview-2001",
      state: "commented"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request_review",
      "x-hub-signature-256": signature
    },
    payload
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    queued: true,
    taskId: "task-created",
    messageId: "message-created",
    createdTask: true
  });
  assert.equal(createdTasks.length, 1);
  assert.deepEqual(createdTasks[0], {
    ownerUserId: "user-1",
    input: {
      title: "GitHub PR #42 feedback from @alice",
      draft: true,
      repoId: "repo-1",
      prompt: (appendedMessages[0] as { content: string }).content,
      taskType: "build",
      baseBranch: "feature/pr-branch",
      branchStrategy: "work_on_branch"
    }
  });
  assert.deepEqual(patches[0], {
    githubPrNumber: 42,
    status: "open",
    workflowStatus: "ready",
    executionStatus: "idle",
    executionAction: "build",
    lastAction: "build"
  });
  assert.deepEqual(appendedMessages[0], {
    role: "user",
    action: "build",
    queueState: "pending",
    queueSource: "github_pr",
    externalId: "github:review:2001",
    content: (appendedMessages[0] as { content: string }).content
  });
  assert.match((appendedMessages[0] as { content: string }).content, /@agentswarm-bot please fix the failing test\./);
  assert.deepEqual(triggeredActions[0], [
    "task-created",
    "build",
    { content: (appendedMessages[0] as { content: string }).content },
    { promptMessageId: "message-created" }
  ]);

  await app.close();
});

test("GitHub PR webhook does not create task without configured GitHub task owner", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  let createCount = 0;

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "agentswarm-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => null,
      createTask: async () => {
        createCount += 1;
        return { id: "unexpected" };
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "submitted",
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 42,
      head: {
        ref: "feature/pr-branch",
        repo: {
          full_name: "acme/repo"
        }
      }
    },
    review: {
      id: 2001,
      body: "@agentswarm-bot please fix the failing test.",
      html_url: "https://github.com/acme/repo/pull/42#pullrequestreview-2001",
      state: "commented"
    },
    sender: {
      login: "alice",
      type: "User"
    }
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  const response = await app.inject({
    method: "POST",
    url: "/github/webhooks/repo-1",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request_review",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "missing_github_task_owner" });
  assert.equal(createCount, 0);

  await app.close();
});
