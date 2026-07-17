import type { Meta, StoryObj } from "@storybook/react";
import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import { Button, Collapse, Flex, Typography } from "antd";
import type { TaskChangeProposal, TaskMessage, TaskRun } from "@verft/shared-types";
import { buildTaskHistoryEntries } from "../src/utils/task-history";
import { TaskHistoryGroupedAutoRunCard } from "./task-history-grouped-auto-run-card";

const taskId = "task-history-story";

const promptMessage: TaskMessage = {
  id: "message-build-prompt",
  taskId,
  role: "user",
  action: "build",
  content: "create a pr for that and give me documentation about it so i can test",
  createdAt: "2026-07-13T13:42:00.000Z"
};

const summaryMessage: TaskMessage = {
  id: "message-build-summary",
  taskId,
  role: "assistant",
  action: "build",
  content: "Opened a pull request and added testing documentation for the change.",
  createdAt: "2026-07-13T13:45:33.000Z"
};

const run: TaskRun = {
  id: "run-build-history",
  taskId,
  action: "build",
  promptMessageId: promptMessage.id,
  provider: "codex",
  providerProfile: "high",
  modelOverride: "gpt-5.4",
  branchName: "task/create-pr-docs",
  status: "succeeded",
  startedAt: "2026-07-13T13:43:23.000Z",
  finishedAt: "2026-07-13T13:45:33.000Z",
  summary: summaryMessage.content,
  changeOutcome: "changed",
  errorMessage: null,
  hasRawJson: true,
  timelineEvents: Array.from({ length: 52 }, (_, index) => ({
    id: `event-${index + 1}`,
    provider: "codex" as const,
    kind: index % 2 === 0 ? "tool.completed" : "assistant.message",
    rawEventIndex: index,
    title: index % 2 === 0 ? "Updated workspace files" : "Generated implementation notes"
  })),
  logs: []
};

const proposal: TaskChangeProposal = {
  id: "proposal-build-history",
  taskId,
  sourceType: "build_run",
  sourceId: run.id,
  status: "applied",
  fromRef: "abc1234",
  toRef: "def5678",
  diff: "diff --git a/docs/testing.md b/docs/testing.md\n+ Add testing documentation\n",
  diffStat: "3 files changed, 124 insertions(+), 12 deletions(-)",
  changedFiles: ["docs/testing.md", "apps/web/components/task-detail-page.tsx", "apps/web/src/utils/task-history.ts"],
  diffTruncated: false,
  untrackedPathsAtCheckpoint: [],
  createdAt: "2026-07-13T13:45:40.000Z",
  resolvedAt: "2026-07-13T13:46:00.000Z",
  revertedAt: null
};

function TaskHistoryExample() {
  const [entry] = buildTaskHistoryEntries({ messages: [promptMessage, summaryMessage], runs: [run], proposals: [proposal] });

  if (!entry || entry.kind !== "grouped_auto_run") {
    return null;
  }

  return (
    <TaskHistoryGroupedAutoRunCard
      entryKey={entry.key}
      entry={entry}
      cardStyle={{ maxWidth: 1120 }}
      showCheckpointState
      showRunCancel={false}
      cancelLoading={false}
      renderMarkdown={(markdown) => <Typography.Paragraph style={{ marginBottom: 0, fontSize: 16 }}>{markdown}</Typography.Paragraph>}
      renderRunErrorNotice={() => null}
      renderRunTimelineCollapse={() => (
        <Collapse
          size="small"
          items={[
            {
              key: "timeline",
              label: "Timeline (23/52)",
              extra: (
                <Button size="small" type="text" icon={<DownloadOutlined />} onClick={(event) => event.stopPropagation()}>
                  Raw JSON
                </Button>
              ),
              children: <Typography.Text type="secondary">Timeline events are collapsed in this example.</Typography.Text>
            }
          ]}
        />
      )}
      renderSummaryCopyButton={() => (
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={(event) => event.stopPropagation()}>
          Copy
        </Button>
      )}
      renderCheckpointDiffSection={(checkpoint) => (
        <Collapse
          size="small"
          items={[
            {
              key: "diff",
              label: `Diff (${checkpoint.changedFiles.length})`,
              extra: (
                <Button size="small" onClick={(event) => event.stopPropagation()}>
                  Revert
                </Button>
              ),
              children: <Typography.Text type="secondary">{checkpoint.diffStat}</Typography.Text>
            }
          ]}
        />
      )}
    />
  );
}

const meta = {
  title: "Components/TaskHistory",
  component: TaskHistoryExample,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Flex style={{ padding: 24 }}>
        <Story />
      </Flex>
    )
  ]
} satisfies Meta<typeof TaskHistoryExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
