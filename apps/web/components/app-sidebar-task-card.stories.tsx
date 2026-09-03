import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import type { Task } from "@verft/shared-types";
import { Flex, Typography } from "antd";
import { AppSidebarTaskCard } from "./app-sidebar-task-card";

const updatedAt = new Date("2026-07-17T14:24:00.000Z").toISOString();

const baseTask: Task = {
  id: "task-sidebar-card",
  title: "Refine repository onboarding flow",
  pinned: true,
  hasPendingCheckpoint: false,
  autoApplyCheckpoints: false,
  shareWithTeam: false,
  activeInteractiveSession: false,
  activeTerminalSessionMode: null,
  linkedWorkspaces: [],
  parentTaskId: null,
  rootTaskId: null,
  ownerUserId: "user-1",
  creatorName: "Andreas",
  repoId: "repo-1",
  repoName: "verft / web",
  repoUrl: "https://github.com/example/verft",
  repoDefaultBranch: "main",
  githubPrNumber: null,
  githubIssueNumber: null,
  slackChannelId: null,
  slackThreadTs: null,
  taskType: "build",
  provider: "codex",
  providerProfile: "high",
  modelOverride: "gpt-5.1",
  baseBranch: "main",
  branchStrategy: "feature_branch",
  complexity: "normal",
  branchName: "task/refine-repository-onboarding-flow",
  workspaceBaseRef: "main",
  prompt: "Improve the repository onboarding flow and tighten empty states.",
  resultMarkdown: null,
  executionSummary: "",
  branchDiff: null,
  pullCount: 0,
  pushCount: 0,
  lastAction: "build",
  status: "done",
  workflowStatus: "done",
  executionStatus: "idle",
  executionAction: null,
  reviewReason: null,
  logs: [],
  enqueued: false,
  createdAt: new Date("2026-07-17T12:00:00.000Z").toISOString(),
  updatedAt,
  startedAt: null,
  finishedAt: null,
  errorMessage: null
};

const meta = {
  title: "Components/AppSidebarTaskCard",
  component: AppSidebarTaskCard,
  tags: ["autodocs"],
  args: {
    task: baseTask,
    selected: false,
    canEditTask: true,
    pinningTaskId: null,
    seenTaskVersions: { [baseTask.id]: baseTask.updatedAt },
    onOpenTask: () => undefined,
    onTogglePin: () => undefined
  },
  decorators: [
    (Story) => (
      <div style={{ width: 300 }}>
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof AppSidebarTaskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true
  }
};

export const Running: Story = {
  args: {
    task: {
      ...baseTask,
      id: "task-running",
      title: "Build Storybook stories for task timeline",
      status: "building",
      workflowStatus: "in_progress",
      executionStatus: "running",
      executionAction: "build",
      pinned: false
    },
    seenTaskVersions: { "task-running": updatedAt }
  }
};

export const PendingCheckpoint: Story = {
  args: {
    task: {
      ...baseTask,
      id: "task-checkpoint",
      title: "Review generated workspace diff before applying",
      status: "awaiting_review",
      workflowStatus: "review",
      hasPendingCheckpoint: true,
      reviewReason: "checkpoint",
      pinned: false
    },
    seenTaskVersions: { "task-checkpoint": updatedAt }
  }
};

export const Failed: Story = {
  args: {
    task: {
      ...baseTask,
      id: "task-failed",
      title: "Fix flaky Docker socket discovery on macOS",
      status: "failed",
      workflowStatus: "in_progress",
      executionStatus: "failed",
      errorMessage: "Docker socket was not reachable.",
      pinned: false
    },
    seenTaskVersions: { "task-failed": updatedAt }
  }
};

export const WithoutEditPermission: Story = {
  args: {
    canEditTask: false
  }
};

export const SidebarStack: Story = {
  render: (args) => (
    <Flex vertical gap={8} style={{ width: 300 }}>
      <Typography.Text type="secondary" strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Recent
      </Typography.Text>
      <AppSidebarTaskCard {...args} selected task={baseTask} />
      <AppSidebarTaskCard
        {...args}
        task={{ ...baseTask, id: "task-stack-running", title: "Run smoke test against remote runner", status: "asking", executionStatus: "running", pinned: false }}
        seenTaskVersions={{ "task-stack-running": updatedAt }}
      />
      <AppSidebarTaskCard
        {...args}
        task={{ ...baseTask, id: "task-stack-unseen", title: "Document local Storybook workflow", pinned: false }}
        seenTaskVersions={{}}
      />
    </Flex>
  )
};
