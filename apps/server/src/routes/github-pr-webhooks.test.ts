import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { registerGitHubPrWebhookRoutes } from "./github-pr-webhooks.js";

const defaultSettingsStore = {
  getSettings: async () => ({
    defaultProvider: "codex",
    codexDefaultEffort: "high",
    codexDefaultModel: "gpt-5.5",
    claudeDefaultEffort: "high",
    claudeDefaultModel: "claude-opus-4-8"
  }),
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

test("GitHub PR merged webhook ignores archive when repository toggle is disabled", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let taskLookupCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1", defaultBranch: "develop", githubPrAutoArchiveOnMerge: false }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        taskLookupCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "closed",
    pull_request: {
      number: 42,
      merged: true,
      head: { ref: "feature/pr-42" },
      base: { ref: "develop" }
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
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { archived: false, reason: "auto_archive_disabled" });
  assert.equal(taskLookupCount, 0);

  await app.close();
});

test("GitHub PR merged webhook archives linked task when repository toggle is enabled", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  const mergeEvents: unknown[] = [];
  const archivedTaskIds: string[] = [];
  const removedQueueTaskIds: string[] = [];
  const logs: Array<{ taskId: string; line: string }> = [];

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({ id: "repo-1", defaultBranch: "develop", githubPrAutoArchiveOnMerge: true }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => ({
        id: "task-1",
        status: "open",
        executionStatus: "idle",
        branchName: "feature/pr-42"
      }),
      publishTaskMergedEvent: async (input: unknown) => {
        mergeEvents.push(input);
      },
      archiveTask: async (taskId: string) => {
        archivedTaskIds.push(taskId);
        return null;
      },
      appendLog: async (taskId: string, line: string) => {
        logs.push({ taskId, line });
        return null;
      }
    } as never,
    taskQueueStore: {
      removeTask: async (taskId: string) => {
        removedQueueTaskIds.push(taskId);
      }
    },
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "closed",
    pull_request: {
      number: 42,
      merged: true,
      head: { ref: "feature/pr-42" },
      base: { ref: "develop" }
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
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { archived: true, taskId: "task-1" });
  assert.deepEqual(mergeEvents, [
    {
      taskId: "task-1",
      sourceBranch: "feature/pr-42",
      targetBranch: "develop",
      commitMessage: null
    }
  ]);
  assert.deepEqual(removedQueueTaskIds, ["task-1"]);
  assert.deepEqual(archivedTaskIds, ["task-1"]);
  assert.deepEqual(logs, [{ taskId: "task-1", line: "Task archived after GitHub PR #42 was merged." }]);

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
        githubIntegrationBotLogin: "verft-bot",
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
        githubIntegrationBotLogin: "verft-bot",
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
      body: "@Verft-Bot please add a regression test.",
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
  assert.match((appendedMessages[0] as { content: string }).content, /@Verft-Bot please add a regression test\./);

  await app.close();
});

test("GitHub PR webhook queues edited comments with required bot mention", async () => {
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
        githubIntegrationBotLogin: "verft-bot",
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
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "edited",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "@verft-bot please add a regression test after this edit.",
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
  assert.deepEqual(appendedMessages[0], {
    role: "user",
    action: "build",
    queueState: "pending",
    queueSource: "github_pr",
    externalId: "github:pr_comment:1001",
    content: (appendedMessages[0] as { content: string }).content
  });
  assert.match((appendedMessages[0] as { content: string }).content, /after this edit\./);

  await app.close();
});

test("GitHub PR webhook ignores edited comments that were already processed", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let appendCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => ({
        id: "task-1",
        executionStatus: "idle"
      }),
      listMessages: async () => [{ externalId: "github:pr_comment:1001" }],
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
    action: "edited",
    issue: {
      number: 42,
      pull_request: {}
    },
    comment: {
      id: 1001,
      body: "@verft-bot please add one more test.",
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
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "duplicate" });
  assert.equal(appendCount, 0);

  await app.close();
});

test("GitHub PR webhook uses repository feedback instructions as a full template", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const appendedMessages: unknown[] = [];
  const secret = "webhook-secret";
  const customInstructions = "Custom feedback template for {{target_ref}}: {{title}}\nFrom @{{author}}\n{{feedback_body}}\n{{url}}";

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
      title: "Improve customer import",
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
  assert.equal(
    (appendedMessages[0] as { content: string }).content,
    "Custom feedback template for PR #42: Improve customer import\nFrom @alice\nPlease add a regression test.\nhttps://github.com/acme/repo/pull/42#issuecomment-1001"
  );
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
        githubIntegrationBotLogin: "verft-bot",
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
      body: "@verft-bot please fix the failing test.",
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
      branchStrategy: "work_on_branch",
      provider: "codex",
      providerProfile: "high",
      modelOverride: "gpt-5.5"
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
  assert.match((appendedMessages[0] as { content: string }).content, /@verft-bot please fix the failing test\./);
  assert.deepEqual(triggeredActions[0], [
    "task-created",
    "build",
    { content: (appendedMessages[0] as { content: string }).content },
    { promptMessageId: "message-created" }
  ]);

  await app.close();
});

test("GitHub PR webhook queues linked review requests for the integration bot", async () => {
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
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true
      }),
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
    action: "review_requested",
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 42,
      title: "Improve importer",
      body: "Please review the importer changes.",
      html_url: "https://github.com/acme/repo/pull/42",
      head: {
        ref: "feature/importer",
        repo: {
          full_name: "acme/repo"
        }
      }
    },
    requested_reviewer: {
      login: "verft-bot"
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
      "x-github-event": "pull_request",
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
    externalId: "github:review_requested:42:reviewer:verft-bot",
    content:
      "A GitHub pull request review was requested for PR #42.\n\nRequested by: @alice\nRequested reviewer: @verft-bot\nTitle: Improve importer\nURL: https://github.com/acme/repo/pull/42\n\nPull request body:\nPlease review the importer changes.\n\nReview the pull request and leave GitHub review feedback or comments.\nDo not make code changes unless these instructions explicitly request them.\n\nAfter completing the review, reply on GitHub at the URL above with a brief status."
  });
  assert.deepEqual(triggeredActions[0], ["task-1", "build", { content: (appendedMessages[0] as { content: string }).content }, { promptMessageId: "message-1" }]);

  await app.close();
});

test("GitHub PR webhook creates auto-apply build task for unlinked review requests", async () => {
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
  const reviewInstructions = "Review {{target_ref}} for @{{requested_reviewer}} by @{{author}}\n{{url_line}}";

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
        githubIntegrationBotLogin: "verft-bot",
        githubPrReviewInstructions: reviewInstructions,
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
    action: "review_requested",
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 42,
      title: "Improve importer",
      body: "Please review the importer changes.",
      html_url: "https://github.com/acme/repo/pull/42",
      head: {
        ref: "feature/importer",
        repo: {
          full_name: "acme/repo"
        }
      }
    },
    requested_reviewer: {
      login: "verft-bot"
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
      "x-github-event": "pull_request",
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
  assert.deepEqual(createdTasks[0], {
    ownerUserId: "user-1",
    input: {
      title: "GitHub PR #42 review requested",
      draft: true,
      repoId: "repo-1",
      prompt: "Review PR #42 for @verft-bot by @alice\nURL: https://github.com/acme/repo/pull/42",
      taskType: "build",
      baseBranch: "feature/importer",
      branchStrategy: "work_on_branch",
      provider: "codex",
      providerProfile: "high",
      modelOverride: "gpt-5.5",
      autoApplyCheckpoints: true
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
    externalId: "github:review_requested:42:reviewer:verft-bot",
    content: "Review PR #42 for @verft-bot by @alice\nURL: https://github.com/acme/repo/pull/42"
  });
  assert.deepEqual(triggeredActions[0], [
    "task-created",
    "build",
    { content: "Review PR #42 for @verft-bot by @alice\nURL: https://github.com/acme/repo/pull/42" },
    { promptMessageId: "message-created" }
  ]);

  await app.close();
});

test("GitHub PR webhook ignores review requests for other reviewers", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  let taskLookupCount = 0;

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "verft-bot"
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubPrNumber: async () => {
        taskLookupCount += 1;
        return null;
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "review_requested",
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 42,
      html_url: "https://github.com/acme/repo/pull/42",
      head: {
        ref: "feature/importer",
        repo: {
          full_name: "acme/repo"
        }
      }
    },
    requested_reviewer: {
      login: "bob"
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
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature
    },
    payload
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "review_request_not_for_bot" });
  assert.equal(taskLookupCount, 0);

  await app.close();
});

test("GitHub webhook queues linked issue comments", async () => {
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
      findTaskByGitHubIssueNumber: async () => ({
        id: "task-issue",
        executionStatus: "idle"
      }),
      listMessages: async () => [],
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-issue",
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
      id: 9001,
      number: 77,
      title: "Import customers fails"
    },
    comment: {
      id: 3001,
      body: "Please fix the import failure.",
      html_url: "https://github.com/acme/repo/issues/77#issuecomment-3001"
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
    queueSource: "github_issue",
    externalId: "github:issue_comment:3001",
    content:
      "A new GitHub issue feedback item was added to linked issue #77.\n\nType: issue_comment\nAuthor: @alice\nIssue title: Import customers fails\nURL: https://github.com/acme/repo/issues/77#issuecomment-3001\n\nFeedback:\nPlease fix the import failure.\n\nIf the feedback is a question without a clear requested code or file change, reply on GitHub asking for confirmation or a follow-up before changing files.\n\nAfter handling this feedback, reply on GitHub at the URL above with a brief status."
  });
  assert.equal(triggeredActions.length, 1);
  assert.deepEqual(triggeredActions[0], ["task-issue", "build", { content: (appendedMessages[0] as { content: string }).content }, { promptMessageId: "message-issue" }]);

  await app.close();
});

test("GitHub webhook reacts with eyes to linked issue comments", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const appendedMessages: unknown[] = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return Response.json({ id: 1 }, { status: 201 });
  }) as typeof fetch;

  const secret = "webhook-secret";

  try {
    registerGitHubPrWebhookRoutes(app, {
      repositoryStore: {
        getRepository: async () => ({ id: "repo-1" }),
        getRepositoryGitHubPrWebhookSecret: async () => secret
      } as never,
      taskStore: {
        findTaskByGitHubIssueNumber: async () => ({
          id: "task-issue",
          executionStatus: "queued"
        }),
        listMessages: async () => [],
        appendMessage: async (_taskId: string, input: unknown) => {
          appendedMessages.push(input);
          return {
            id: "message-issue",
            content: (input as { content: string }).content
          };
        }
      } as never,
      scheduler: {} as never,
      settingsStore: {
        ...defaultSettingsStore,
        getRuntimeCredentials: async () => ({
          githubToken: "github-token"
        })
      } as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      action: "created",
      repository: {
        full_name: "acme/repo"
      },
      issue: {
        id: 9001,
        number: 77,
        title: "Import customers fails"
      },
      comment: {
        id: 3001,
        body: "Please fix the import failure.",
        html_url: "https://github.com/acme/repo/issues/77#issuecomment-3001"
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
    assert.deepEqual(JSON.parse(response.body), { queued: true, taskId: "task-issue", messageId: "message-issue" });
    assert.equal(appendedMessages.length, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, "https://api.github.com/repos/acme/repo/issues/comments/3001/reactions");
    assert.equal(fetchCalls[0]?.init?.method, "POST");
    assert.equal((fetchCalls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer github-token");
    assert.deepEqual(JSON.parse(String(fetchCalls[0]?.init?.body)), { content: "eyes" });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub webhook ignores task-created issue comments without reacting", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return Response.json({ id: 1 }, { status: 201 });
  }) as typeof fetch;

  let lookupCount = 0;
  const secret = "webhook-secret";

  try {
    registerGitHubPrWebhookRoutes(app, {
      repositoryStore: {
        getRepository: async () => ({ id: "repo-1" }),
        getRepositoryGitHubPrWebhookSecret: async () => secret
      } as never,
      taskStore: {
        findTaskByGitHubIssueNumber: async () => {
          lookupCount += 1;
          return {
            id: "task-issue",
            executionStatus: "queued"
          };
        }
      } as never,
      scheduler: {} as never,
      settingsStore: {
        ...defaultSettingsStore,
        getRuntimeCredentials: async () => ({
          githubToken: "github-token"
        })
      } as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      action: "created",
      repository: {
        full_name: "acme/repo"
      },
      issue: {
        id: 9001,
        number: 77,
        title: "Import customers fails"
      },
      comment: {
        id: 3002,
        body:
          "🤖 A new task has been created and will start working on this shortly.\n\nTask: http://localhost:3217/tasks/task-issue\n\nI’ll post progress updates here as work continues.\n\n<!-- verft-task-created:task-issue -->",
        html_url: "https://github.com/acme/repo/issues/77#issuecomment-3002"
      },
      sender: {
        login: "verftbot",
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
    assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "ignored_event" });
    assert.equal(lookupCount, 0);
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub webhook ignores assigned issue comments without required bot mention", async () => {
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
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubIssueNumber: async () => {
        lookupCount += 1;
        return {
          id: "task-issue",
          executionStatus: "idle"
        };
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
      id: 9001,
      number: 77,
      title: "Import customers fails",
      assignees: [
        {
          login: "verft-bot"
        }
      ]
    },
    comment: {
      id: 3001,
      body: "Please fix the import failure.",
      html_url: "https://github.com/acme/repo/issues/77#issuecomment-3001"
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

test("GitHub webhook queues edited issue comments with required bot mention", async () => {
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
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubIssueNumber: async () => ({
        id: "task-issue",
        executionStatus: "queued"
      }),
      listMessages: async () => [],
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-issue",
          content: (input as { content: string }).content
        };
      }
    } as never,
    scheduler: {} as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "edited",
    issue: {
      id: 9001,
      number: 77,
      title: "Import customers fails"
    },
    comment: {
      id: 3001,
      body: "@verft-bot please fix the import failure after this edit.",
      html_url: "https://github.com/acme/repo/issues/77#issuecomment-3001"
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
  assert.deepEqual(JSON.parse(response.body), { queued: true, taskId: "task-issue", messageId: "message-issue" });
  assert.equal(appendedMessages.length, 1);
  assert.deepEqual(appendedMessages[0], {
    role: "user",
    action: "build",
    queueState: "pending",
    queueSource: "github_issue",
    externalId: "github:issue_comment:3001",
    content: (appendedMessages[0] as { content: string }).content
  });
  assert.match((appendedMessages[0] as { content: string }).content, /after this edit\./);

  await app.close();
});

test("GitHub webhook ignores edited issue comments that were already processed", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  let appendCount = 0;
  const secret = "webhook-secret";

  registerGitHubPrWebhookRoutes(app, {
    repositoryStore: {
      getRepository: async () => ({
        id: "repo-1",
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubIssueNumber: async () => ({
        id: "task-issue",
        executionStatus: "idle"
      }),
      listMessages: async () => [{ externalId: "github:issue_comment:3001" }],
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
    action: "edited",
    issue: {
      id: 9001,
      number: 77,
      title: "Import customers fails"
    },
    comment: {
      id: 3001,
      body: "@verft-bot please add one more issue test.",
      html_url: "https://github.com/acme/repo/issues/77#issuecomment-3001"
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
  assert.deepEqual(JSON.parse(response.body), { queued: false, reason: "duplicate" });
  assert.equal(appendCount, 0);

  await app.close();
});

test("GitHub webhook creates feature branch task from the first issue-linked branch", async () => {
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
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    if (url === "https://api.github.com/graphql") {
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                linkedBranches: {
                  nodes: [
                    { ref: { name: "feature/first-linked" } },
                    { ref: { name: "feature/second-linked" } }
                  ]
                }
              }
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (init?.method === "POST") {
      return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const openedTask = {
    id: "task-issue-created",
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
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true,
        githubPrInitialInstructions: "Initial template for {{target_ref}}\n{{issue_title_line}}Body: {{feedback_body}}",
        githubPrTaskOwnerUserId: "user-1"
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubIssueNumber: async () => null,
      createTask: async (input: unknown, _repository: unknown, ownerUserId: string) => {
        createdTasks.push({ input, ownerUserId });
        return {
          id: "task-issue-created"
        };
      },
      patchTask: async (_taskId: string, patch: unknown) => {
        patches.push(patch);
        return openedTask;
      },
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-issue-created",
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
    settingsStore: {
      ...defaultSettingsStore,
      getRuntimeCredentials: async () => ({
        githubToken: "github-token"
      })
    } as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "opened",
    repository: {
      full_name: "acme/repo"
    },
    issue: {
      id: 9001,
      number: 77,
      title: "Import customers fails",
      body: "@verft-bot please fix customer imports.",
      html_url: "https://github.com/acme/repo/issues/77"
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
      "x-github-event": "issues",
      "x-hub-signature-256": signature
    },
    payload
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    queued: true,
    taskId: "task-issue-created",
    messageId: "message-issue-created",
    createdTask: true
  });
  assert.deepEqual(createdTasks[0], {
    ownerUserId: "user-1",
    input: {
      title: "Import customers fails",
      draft: true,
      repoId: "repo-1",
      prompt: (appendedMessages[0] as { content: string }).content,
      taskType: "build",
      baseBranch: "feature/first-linked",
      branchStrategy: "feature_branch",
      autoApplyCheckpoints: true,
      provider: "codex",
      providerProfile: "high",
      modelOverride: "gpt-5.5"
    }
  });
  assert.deepEqual(patches[0], {
    githubIssueNumber: 77,
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
    queueSource: "github_issue",
    externalId: "github:issue:9001",
    content: "Initial template for issue #77\nIssue title: Import customers fails\nBody: @verft-bot please fix customer imports."
  });
  assert.deepEqual(triggeredActions[0], [
    "task-issue-created",
    "build",
    { content: (appendedMessages[0] as { content: string }).content },
    { promptMessageId: "message-issue-created" }
  ]);
  assert.equal(fetchCalls[0]?.url, "https://api.github.com/graphql");
  const graphQlBody = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    query: string;
    variables: { owner: string; name: string; issueNumber: number };
  };
  assert.match(graphQlBody.query, /linkedBranches\(first: 1\)/);
  assert.deepEqual(graphQlBody.variables, {
    owner: "acme",
    name: "repo",
    issueNumber: 77
  });

  globalThis.fetch = originalFetch;
  await app.close();
});

test("GitHub webhook posts an initial task comment when creating an issue task", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (init?.method === "POST") {
      return Response.json({ id: 1 }, { status: 201 });
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const openedTask = {
      id: "task-issue-created",
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
          githubIntegrationBotLogin: "verft-bot",
          githubPrRequireBotMention: true,
          githubPrTaskOwnerUserId: "user-1"
        }),
        getRepositoryGitHubPrWebhookSecret: async () => secret
      } as never,
      taskStore: {
        findTaskByGitHubIssueNumber: async () => null,
        createTask: async () => ({ id: "task-issue-created" }),
        patchTask: async () => openedTask,
        appendMessage: async (_taskId: string, input: unknown) => ({
          id: "message-issue-created",
          content: (input as { content: string }).content
        }),
        setExecutionState: async () => openedTask
      } as never,
      scheduler: {
        triggerAction: async () => true
      } as never,
      settingsStore: {
        ...defaultSettingsStore,
        getRuntimeCredentials: async () => ({
          githubToken: "github-token"
        })
      } as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      action: "opened",
      repository: {
        full_name: "acme/repo"
      },
      issue: {
        id: 9001,
        number: 77,
        title: "Import customers fails",
        body: "@verft-bot please fix customer imports.",
        html_url: "https://github.com/acme/repo/issues/77"
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
        "x-github-event": "issues",
        "x-hub-signature-256": signature
      },
      payload
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(response.statusCode, 202);
    assert.equal(fetchCalls.length, 3);
    assert.equal(fetchCalls[0]?.url, "https://api.github.com/graphql");
    assert.equal(fetchCalls[1]?.url, "https://api.github.com/repos/acme/repo/issues/77/comments?per_page=100");
    assert.equal(fetchCalls[2]?.url, "https://api.github.com/repos/acme/repo/issues/77/comments");
    assert.equal(fetchCalls[2]?.init?.method, "POST");
    assert.equal((fetchCalls[2]?.init?.headers as Record<string, string>).Authorization, "Bearer github-token");
    assert.deepEqual(JSON.parse(String(fetchCalls[2]?.init?.body)), {
      body:
        "🤖 A new task has been created and will start working on this shortly.\n\nTask: http://localhost:3217/tasks/task-issue-created\n\nI’ll post progress updates here as work continues.\n\n<!-- verft-task-created:task-issue-created -->"
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub webhook uses a custom task created comment template", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (init?.method === "POST") {
      return Response.json({ id: 1 }, { status: 201 });
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const openedTask = {
      id: "task-custom-comment",
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
          githubIntegrationBotLogin: "verft-bot",
          githubPrRequireBotMention: true,
          githubPrTaskOwnerUserId: "user-1",
          githubPrTaskCreatedCommentTemplate:
            "Task {{task_id}} is ready for {{target_ref}} in {{repository_full_name}}.\nOpen: {{task_url}}\nRequested by @{{author}}."
        }),
        getRepositoryGitHubPrWebhookSecret: async () => secret
      } as never,
      taskStore: {
        findTaskByGitHubIssueNumber: async () => null,
        createTask: async () => ({ id: "task-custom-comment" }),
        patchTask: async () => openedTask,
        appendMessage: async (_taskId: string, input: unknown) => ({
          id: "message-issue-created",
          content: (input as { content: string }).content
        }),
        setExecutionState: async () => openedTask
      } as never,
      scheduler: {
        triggerAction: async () => true
      } as never,
      settingsStore: {
        ...defaultSettingsStore,
        getRuntimeCredentials: async () => ({
          githubToken: "github-token"
        })
      } as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      action: "opened",
      repository: {
        full_name: "acme/repo"
      },
      issue: {
        id: 9001,
        number: 77,
        title: "Import customers fails",
        body: "@verft-bot please fix customer imports.",
        html_url: "https://github.com/acme/repo/issues/77"
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
        "x-github-event": "issues",
        "x-hub-signature-256": signature
      },
      payload
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(response.statusCode, 202);
    assert.equal(fetchCalls[2]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(fetchCalls[2]?.init?.body)), {
      body:
        "Task task-custom-comment is ready for issue #77 in acme/repo.\nOpen: http://localhost:3217/tasks/task-custom-comment\nRequested by @alice.\n\n<!-- verft-task-created:task-custom-comment -->"
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub webhook skips duplicate initial task comments for retried issue task creation", async () => {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    done(null, JSON.parse(rawBody));
  });

  const secret = "webhook-secret";
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return Response.json([
      {
        body:
          "🤖 A new task has been created and will start working on this shortly.\n\nTask: http://localhost:3217/tasks/task-issue-created\n\nI’ll post progress updates here as work continues.\n\n<!-- verft-task-created:task-issue-created -->"
      }
    ]);
  }) as typeof fetch;

  try {
    const openedTask = {
      id: "task-issue-created",
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
          githubIntegrationBotLogin: "verft-bot",
          githubPrRequireBotMention: true,
          githubPrTaskOwnerUserId: "user-1"
        }),
        getRepositoryGitHubPrWebhookSecret: async () => secret
      } as never,
      taskStore: {
        findTaskByGitHubIssueNumber: async () => null,
        createTask: async () => ({ id: "task-issue-created" }),
        patchTask: async () => openedTask,
        appendMessage: async (_taskId: string, input: unknown) => ({
          id: "message-issue-created",
          content: (input as { content: string }).content
        }),
        setExecutionState: async () => openedTask
      } as never,
      scheduler: {
        triggerAction: async () => true
      } as never,
      settingsStore: {
        ...defaultSettingsStore,
        getRuntimeCredentials: async () => ({
          githubToken: "github-token"
        })
      } as never,
      spawner: defaultSpawner as never
    });

    const payload = JSON.stringify({
      action: "opened",
      repository: {
        full_name: "acme/repo"
      },
      issue: {
        id: 9001,
        number: 77,
        title: "Import customers fails",
        body: "@verft-bot please fix customer imports.",
        html_url: "https://github.com/acme/repo/issues/77"
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
        "x-github-event": "issues",
        "x-hub-signature-256": signature
      },
      payload
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(response.statusCode, 202);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0]?.url, "https://api.github.com/graphql");
    assert.equal(fetchCalls[1]?.url, "https://api.github.com/repos/acme/repo/issues/77/comments?per_page=100");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub webhook creates feature branch task when bot is assigned to an unlinked issue", async () => {
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

  const openedTask = {
    id: "task-assigned-issue",
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
        githubIntegrationBotLogin: "verft-bot",
        githubPrRequireBotMention: true,
        githubPrTaskOwnerUserId: "user-1"
      }),
      getRepositoryGitHubPrWebhookSecret: async () => secret
    } as never,
    taskStore: {
      findTaskByGitHubIssueNumber: async () => null,
      createTask: async (input: unknown, _repository: unknown, ownerUserId: string) => {
        createdTasks.push({ input, ownerUserId });
        return {
          id: "task-assigned-issue"
        };
      },
      patchTask: async (_taskId: string, patch: unknown) => {
        patches.push(patch);
        return openedTask;
      },
      appendMessage: async (_taskId: string, input: unknown) => {
        appendedMessages.push(input);
        return {
          id: "message-assigned-issue",
          content: (input as { content: string }).content
        };
      },
      setExecutionState: async () => openedTask
    } as never,
    scheduler: {
      triggerAction: async () => true
    } as never,
    settingsStore: defaultSettingsStore as never,
    spawner: defaultSpawner as never
  });

  const payload = JSON.stringify({
    action: "opened",
    repository: {
      full_name: "acme/repo"
    },
    issue: {
      id: 9002,
      number: 78,
      title: "Export customers fails",
      body: "Please fix customer exports.",
      html_url: "https://github.com/acme/repo/issues/78",
      assignees: [
        {
          login: "verft-bot"
        }
      ]
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
      "x-github-event": "issues",
      "x-hub-signature-256": signature
    },
    payload
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    queued: true,
    taskId: "task-assigned-issue",
    messageId: "message-assigned-issue",
    createdTask: true
  });
  assert.deepEqual(createdTasks[0], {
    ownerUserId: "user-1",
    input: {
      title: "Export customers fails",
      draft: true,
      repoId: "repo-1",
      prompt: (appendedMessages[0] as { content: string }).content,
      taskType: "build",
      baseBranch: "main",
      branchStrategy: "feature_branch",
      autoApplyCheckpoints: true,
      provider: "codex",
      providerProfile: "high",
      modelOverride: "gpt-5.5"
    }
  });
  assert.deepEqual(patches[0], {
    githubIssueNumber: 78,
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
    queueSource: "github_issue",
    externalId: "github:issue:9002",
    content: (appendedMessages[0] as { content: string }).content
  });

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
        githubIntegrationBotLogin: "verft-bot",
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
      body: "@verft-bot please fix the failing test.",
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
