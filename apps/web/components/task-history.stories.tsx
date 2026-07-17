import type { Meta, StoryObj } from "@storybook/react";
import { DownloadOutlined } from "@ant-design/icons";
import { Button, Flex, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskChangeProposal, TaskMessage, TaskRun } from "@verft/shared-types";
import { buildTaskHistoryEntries, type GroupedAutoRunHistoryEntry } from "../src/utils/task-history";
import { TaskHistoryGroupedAutoRunCard, type TaskHistoryCheckpointDiffActions } from "./task-history-grouped-auto-run-card";

const taskId = "task-history-story";

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={3}>{children}</Typography.Title>,
  h2: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={4}>{children}</Typography.Title>,
  h3: ({ children }: { children?: React.ReactNode }) => <Typography.Title level={5}>{children}</Typography.Title>,
  p: ({ children }: { children?: React.ReactNode }) => <Typography.Paragraph>{children}</Typography.Paragraph>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ marginBlock: 0, paddingInlineStart: 20 }}>{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ marginBlock: 0, paddingInlineStart: 20 }}>{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ marginBottom: 8 }}>
      <Typography.Text>{children}</Typography.Text>
    </li>
  )
};

function createMessage(input: Omit<TaskMessage, "taskId">): TaskMessage {
  return { taskId, ...input };
}

function createRun(input: Omit<TaskRun, "taskId" | "provider" | "providerProfile" | "modelOverride" | "branchName" | "logs">): TaskRun {
  return {
    taskId,
    provider: "codex",
    providerProfile: "high",
    modelOverride: "gpt-5.4",
    branchName: "task/history-storybook-states",
    logs: [],
    ...input
  };
}

function createProposal(input: Omit<TaskChangeProposal, "taskId" | "sourceType" | "fromRef" | "toRef" | "diff" | "diffTruncated" | "untrackedPathsAtCheckpoint">): TaskChangeProposal {
  return {
    taskId,
    sourceType: "build_run",
    fromRef: "abc1234",
    toRef: "def5678",
    diff: "diff --git a/test.txt b/test.txt\n-hello world\n",
    diffTruncated: false,
    untrackedPathsAtCheckpoint: [],
    ...input
  };
}

function createTimelineEvents(count: number): NonNullable<TaskRun["timelineEvents"]> {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${count}-${index + 1}`,
    provider: "codex" as const,
    kind: index % 2 === 0 ? "tool.completed" : "assistant.message",
    rawEventIndex: index,
    title: index % 2 === 0 ? "Updated workspace files" : "Generated implementation notes"
  }));
}

function buildGroupedEntry(input: {
  prompt: TaskMessage;
  summary?: TaskMessage;
  run: TaskRun;
  proposal?: TaskChangeProposal;
}): GroupedAutoRunHistoryEntry {
  const [entry] = buildTaskHistoryEntries({
    messages: input.summary ? [input.prompt, input.summary] : [input.prompt],
    runs: [input.run],
    proposals: input.proposal ? [input.proposal] : []
  });

  if (!entry || entry.kind !== "grouped_auto_run") {
    throw new Error("Expected grouped auto-run history entry");
  }

  return entry;
}

const runningPrompt = createMessage({
  id: "message-running-prompt",
  role: "user",
  action: "build",
  content: "Hello World",
  createdAt: "2026-07-17T05:46:28.000Z"
});

const runningRun = createRun({
  id: "run-running",
  action: "build",
  promptMessageId: runningPrompt.id,
  status: "running",
  startedAt: "2026-07-17T05:46:31.000Z",
  finishedAt: "2026-07-17T05:46:34.000Z",
  summary: null,
  changeOutcome: null,
  errorMessage: null,
  hasRawJson: true,
  timelineEvents: createTimelineEvents(2)
});

const pendingPrompt = createMessage({
  id: "message-pending-prompt",
  role: "user",
  action: "build",
  content: "remove the content hello world again",
  createdAt: "2026-07-17T05:46:42.000Z"
});

const pendingSummary = createMessage({
  id: "message-pending-summary",
  role: "assistant",
  action: "build",
  content: "Removed `hello world` from [test.txt](#). File now empty.\n\nskipped: tests, trivial content removal.",
  createdAt: "2026-07-17T05:47:00.000Z"
});

const pendingRun = createRun({
  id: "run-pending",
  action: "build",
  promptMessageId: pendingPrompt.id,
  status: "succeeded",
  startedAt: "2026-07-17T05:46:51.000Z",
  finishedAt: "2026-07-17T05:47:00.000Z",
  summary: pendingSummary.content,
  changeOutcome: "changed",
  errorMessage: null,
  hasRawJson: true,
  timelineEvents: createTimelineEvents(10)
});

const pendingProposal = createProposal({
  id: "proposal-pending",
  sourceId: pendingRun.id,
  status: "pending",
  diffStat: "1 file changed, 1 deletion(-)",
  changedFiles: ["test.txt"],
  createdAt: "2026-07-17T05:47:01.000Z",
  resolvedAt: null,
  revertedAt: null
});

const appliedPrompt = createMessage({
  id: "message-applied-prompt",
  role: "user",
  action: "build",
  content: "create a pr for that and give me documentation about it so i can test",
  createdAt: "2026-07-13T13:42:00.000Z"
});

const appliedSummary = createMessage({
  id: "message-applied-summary",
  role: "assistant",
  action: "build",
  content: "Opened a pull request and added testing documentation for the change.",
  createdAt: "2026-07-13T13:45:33.000Z"
});

const appliedRun = createRun({
  id: "run-applied",
  action: "build",
  promptMessageId: appliedPrompt.id,
  status: "succeeded",
  startedAt: "2026-07-13T13:43:23.000Z",
  finishedAt: "2026-07-13T13:45:33.000Z",
  summary: appliedSummary.content,
  changeOutcome: "changed",
  errorMessage: null,
  hasRawJson: true,
  timelineEvents: createTimelineEvents(52)
});

const appliedProposal = createProposal({
  id: "proposal-applied",
  sourceId: appliedRun.id,
  status: "applied",
  diffStat: "3 files changed, 124 insertions(+), 12 deletions(-)",
  changedFiles: ["docs/testing.md", "apps/web/components/task-detail-page.tsx", "apps/web/src/utils/task-history.ts"],
  createdAt: "2026-07-13T13:45:40.000Z",
  resolvedAt: "2026-07-13T13:46:00.000Z",
  revertedAt: null
});

const historyItems = [
  {
    entry: buildGroupedEntry({ prompt: runningPrompt, run: runningRun }),
    timelineLabel: "Timeline (2/2)",
    showRunCancel: true,
    diffActions: undefined
  },
  {
    entry: buildGroupedEntry({ prompt: pendingPrompt, summary: pendingSummary, run: pendingRun, proposal: pendingProposal }),
    timelineLabel: "Timeline (8/10)",
    showRunCancel: false,
    diffActions: {
      apply: { visible: true, label: "Apply", primary: true, onClick: () => undefined },
      reject: { visible: true, label: "Reject", danger: true, onClick: () => undefined }
    } satisfies TaskHistoryCheckpointDiffActions
  },
  {
    entry: buildGroupedEntry({ prompt: appliedPrompt, summary: appliedSummary, run: appliedRun, proposal: appliedProposal }),
    timelineLabel: "Timeline (23/52)",
    showRunCancel: false,
    diffActions: {
      revert: { visible: true, label: "Revert", onClick: () => undefined }
    } satisfies TaskHistoryCheckpointDiffActions
  }
];

function TaskHistoryList() {
  return (
    <Flex vertical gap={20} style={{ width: "100%", maxWidth: 1120 }}>
      {historyItems.map((item) => (
        <TaskHistoryGroupedAutoRunCard
          key={item.entry.key}
          entryKey={item.entry.key}
          entry={item.entry}
          showCheckpointState
          showRunCancel={item.showRunCancel}
          cancelLoading={false}
          onCancel={() => undefined}
          renderMarkdown={(markdown) => (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {markdown}
            </ReactMarkdown>
          )}
          renderRunErrorNotice={() => null}
          renderRunTimelineCollapse={() => (
            <Flex vertical gap={12}>
              <Flex justify="space-between" align="center">
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>{item.timelineLabel}</Typography.Text>
                <Button size="small" type="text" icon={<DownloadOutlined />}>
                  Raw JSON
                </Button>
              </Flex>
              <Typography.Text type="secondary">Timeline events would render here.</Typography.Text>
            </Flex>
          )}
          onCopySummary={() => undefined}
          renderCheckpointDiffContent={(checkpoint) => <Typography.Text type="secondary">{checkpoint.diffStat}</Typography.Text>}
          getCheckpointDiffActions={() => item.diffActions ?? {}}
        />
      ))}
    </Flex>
  );
}

const meta = {
  title: "Components/TaskHistory",
  component: TaskHistoryList,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Flex justify="center" style={{ width: "100%" }}>
        <Story />
      </Flex>
    )
  ]
} satisfies Meta<typeof TaskHistoryList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
