import type { Meta, StoryObj } from "@storybook/react";
import { Button, Flex, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseRenderableDiff } from "../src/utils/diff";
import { CheckpointFileEditorModal } from "./checkpoint-file-editor-modal";
import { TaskBinaryDiffCard } from "./task-binary-diff-card";
import { TaskDiffOpenAiPanel } from "./task-diff-openai-panel";
import { TaskFilesTab } from "./task-files-tab";
import { TaskHistoryGroupedAutoRunCard } from "./task-history-grouped-auto-run-card";
import { TaskInteractiveTerminalView } from "./task-interactive-terminal-view";
import { TaskTerminalTranscriptView } from "./task-terminal-transcript-view";
import { WorkspaceFilePreviewModal } from "./workspace-file-preview-modal";
import {
  exampleDiff,
  imageBase64,
  liveDiff,
  taskChangeProposals,
  taskMessages,
  taskRuns,
  tasks,
  terminalTranscript,
  textPreview
} from "../.storybook/fixtures";
import { buildTaskHistoryEntries } from "../src/utils/task-history";

const imageDiff = [
  "diff --git a/apps/web/public/logo-preview.png b/apps/web/public/logo-preview.png",
  "index 1111111..2222222 100644",
  "Binary files a/apps/web/public/logo-preview.png and b/apps/web/public/logo-preview.png differ"
].join("\n");

function Surface({ children = null }: { children?: React.ReactNode }) {
  return <div style={{ maxWidth: 1120 }}>{children}</div>;
}

const meta = {
  title: "Components/Workspace And Diff",
  component: Surface,
  args: {
    children: null
  }
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceFilePreviewText: Story = {
  render: () => (
    <WorkspaceFilePreviewModal
      open
      loading={false}
      filePath={textPreview.path}
      kind="text"
      mimeType={textPreview.mimeType}
      encoding={textPreview.encoding}
      content={textPreview.content}
      sizeBytes={textPreview.sizeBytes}
      line={2}
      error={null}
      onCancel={() => undefined}
    />
  )
};

export const WorkspaceFilePreviewImage: Story = {
  render: () => (
    <WorkspaceFilePreviewModal
      open
      loading={false}
      filePath="apps/web/public/logo-preview.png"
      kind="image"
      mimeType="image/png"
      encoding="base64"
      content={imageBase64}
      sizeBytes={68}
      line={null}
      error={null}
      onCancel={() => undefined}
    />
  )
};

export const CheckpointFileEditor: Story = {
  render: () => (
    <CheckpointFileEditorModal
      open
      taskId={tasks[0].id}
      filePaths={["apps/web/components/app-shell.tsx", "docs/development/testing.md"]}
      initialFilePath="apps/web/components/app-shell.tsx"
      onCancel={() => undefined}
      onSaved={() => undefined}
    />
  )
};

export const TaskFiles: Story = {
  render: () => (
    <Surface>
      <TaskFilesTab taskId={tasks[0].id} active openTarget={null} onOpenTargetHandled={() => undefined} />
    </Surface>
  )
};

export const BinaryImageDiff: Story = {
  render: () => {
    const file = parseRenderableDiff(imageDiff)[0] ?? parseRenderableDiff(exampleDiff)[0];
    if (!file) {
      return <Typography.Text type="secondary">No diff file could be parsed.</Typography.Text>;
    }
    return (
      <Surface>
        <TaskBinaryDiffCard
          file={file}
          collapseFiles={false}
          taskId={tasks[0].id}
          previewRefs={{ before: "abc1234", after: "def5678" }}
        />
      </Surface>
    );
  }
};

export const OpenAiDiffPanel: Story = {
  render: () => (
    <Surface>
      <TaskDiffOpenAiPanel
        diffText={exampleDiff}
        emptyMessage="No diff is available."
        collapseFiles={false}
        taskId={tasks[0].id}
        liveDiff={liveDiff}
        previewRefs={{ before: "abc1234", after: "def5678" }}
        selectionResetToken="storybook"
      />
    </Surface>
  )
};

export const GroupedRunHistoryCard: Story = {
  render: () => {
    const [entry] = buildTaskHistoryEntries({
      messages: taskMessages,
      runs: taskRuns,
      proposals: taskChangeProposals
    });
    if (!entry || entry.kind !== "grouped_auto_run") {
      return <Typography.Text type="secondary">No grouped run history entry could be built.</Typography.Text>;
    }
    return (
      <Surface>
        <TaskHistoryGroupedAutoRunCard
          entryKey={entry.key}
          entry={entry}
          showCheckpointState
          showRunCancel={false}
          cancelLoading={false}
          onCancel={() => undefined}
          renderMarkdown={(markdown) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>}
          renderRunErrorNotice={() => null}
          renderRunTimelineContent={() => <Typography.Text type="secondary">Timeline events render in the task detail page.</Typography.Text>}
          onCopySummary={() => undefined}
          renderCheckpointDiffContent={(checkpoint) => <Typography.Text type="secondary">{checkpoint.diffStat}</Typography.Text>}
          getCheckpointDiffActions={() => ({
            apply: { visible: true, primary: true, label: "Apply", onClick: () => undefined },
            reject: { visible: true, danger: true, label: "Reject", onClick: () => undefined }
          })}
        />
      </Surface>
    );
  }
};

export const InteractiveTerminal: Story = {
  render: () => (
    <div style={{ height: 360, background: "#1e1e1e", padding: 8 }}>
      <TaskInteractiveTerminalView taskId={tasks[0].id} />
    </div>
  )
};

export const TerminalTranscript: Story = {
  render: () => (
    <Surface>
      <TaskTerminalTranscriptView content={terminalTranscript.content} height={320} />
    </Surface>
  )
};

export const WorkspaceActionsOverview: Story = {
  render: () => (
    <Surface>
      <Flex vertical gap={12}>
        <Typography.Title level={4}>Workspace actions</Typography.Title>
        <Flex gap={8} wrap>
          <Button>Open Preview</Button>
          <Button>Edit Checkpoint File</Button>
          <Button>Ask About Diff</Button>
        </Flex>
      </Flex>
    </Surface>
  )
};
