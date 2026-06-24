import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { registerGitHubPrWebhookRoutes } from "./github-pr-webhooks.js";

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
    } as never
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
      "A new GitHub pull request feedback item was added to linked PR #42.\n\nType: pr_comment\nAuthor: @alice\nURL: https://github.com/acme/repo/pull/42#issuecomment-1001\n\nFeedback:\nPlease add a regression test.\n\nAfter handling this feedback, reply on GitHub at the URL above with a brief status."
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
    scheduler: {} as never
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
    scheduler: {} as never
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
