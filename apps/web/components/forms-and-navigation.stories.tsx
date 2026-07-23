import type { Meta, StoryObj } from "@storybook/react";
import {
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  LinkOutlined,
  MoreOutlined,
  PushpinOutlined,
  ReloadOutlined,
  RollbackOutlined
} from "@ant-design/icons";
import { useState } from "react";
import { App, Button, Dropdown, Flex, Form, Space, Typography } from "antd";
import type { TaskDefinitionFormValues } from "./task-definition-fields";
import { AppFooterNote } from "./app-footer-note";
import { AppSidebar } from "./app-sidebar";
import { HarnessMarkdownField } from "./harness-markdown-field";
import { TaskBrowserNotifications } from "./task-browser-notifications";
import { TaskCreateModal } from "./task-create-modal";
import { TaskDefinitionFields, getTaskDefinitionInitialValues } from "./task-definition-fields";
import { TaskPromptComposer, type TaskPromptComposerAction } from "./task-prompt-composer";
import { TaskPromptAttachmentsInput } from "./task-prompt-attachments-input";
import { createTask, repositories, settings, adminSession } from "../.storybook/fixtures";
import type { SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";

function ComponentSurface({ children = null }: { children?: React.ReactNode }) {
  return <div style={{ maxWidth: 960 }}>{children}</div>;
}

const meta = {
  title: "Components/Forms And Navigation",
  component: ComponentSurface,
  args: {
    children: null
  }
} satisfies Meta<typeof ComponentSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

const taskPromptActionOptions: Array<{ label: string; value: TaskPromptComposerAction; disabled?: boolean }> = [
  { label: "Build", value: "build" },
  { label: "Ask", value: "ask" },
  { label: "Comment", value: "comment" },
  { label: "Terminal", value: "terminal" }
];

const taskPromptModelOptions = [
  { label: "GPT-5.5", value: "gpt-5.5" },
  { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
  { label: "GPT-5.5 Mini", value: "gpt-5.5-mini" }
];

const taskPromptMentionOptions = [
  { label: "components/task-detail-page.tsx", value: "components/task-detail-page.tsx" },
  { label: "components/task-prompt-composer.tsx", value: "components/task-prompt-composer.tsx" },
  { label: "src/api/client.ts", value: "src/api/client.ts" }
];

function createStoryImageFile(name: string) {
  return new File(["storybook"], name, { type: "image/png", lastModified: 0 });
}

function TaskPromptFooterActions({
  busy = false,
  pushDisabled = false,
  resetDisabled = false,
  moreLoading = false
}: {
  busy?: boolean;
  pushDisabled?: boolean;
  resetDisabled?: boolean;
  moreLoading?: boolean;
}) {
  return (
    <Space.Compact size="middle">
      <Button loading={busy} disabled={busy}>
        Pull (2)
      </Button>
      <Button type="primary" loading={busy} disabled={pushDisabled || busy}>
        Push (1)
      </Button>
      <Dropdown
        menu={{
          items: [
            {
              key: "links",
              label: "Links",
              type: "group",
              children: [
                { key: "viewPr", icon: <ExportOutlined />, label: "View PR" },
                { key: "viewIssue", icon: <ExportOutlined />, label: "View Issue" }
              ]
            },
            {
              key: "git",
              label: "Git",
              type: "group",
              children: [
                { key: "refreshGitStatus", icon: <ReloadOutlined />, label: "Refresh Git status" },
                { key: "merge", icon: <BranchesOutlined />, label: "Merge" },
                { key: "resetGit", icon: <RollbackOutlined />, label: "Reset Git", danger: true, disabled: resetDisabled || busy }
              ]
            },
            {
              key: "linking",
              label: "Linking",
              type: "group",
              children: [{ key: "linkPr", icon: <LinkOutlined />, label: "Edit Linked PR" }]
            },
            {
              key: "session",
              label: "Session",
              type: "group",
              children: [{ key: "newSession", icon: <EditOutlined />, label: "New Session" }]
            },
            {
              key: "task",
              label: "Task",
              type: "group",
              children: [
                { key: "pin", icon: <PushpinOutlined />, label: "Pin Task" },
                { key: "archive", icon: <DeleteOutlined />, label: "Archive", danger: true }
              ]
            }
          ]
        }}
        trigger={["click"]}
      >
        <Button icon={<MoreOutlined />} loading={moreLoading}>
          More
        </Button>
      </Dropdown>
    </Space.Compact>
  );
}

function StatefulTaskPromptComposer({
  title,
  initialValue = "Please update the task detail layout and check @components/task-detail-page.tsx",
  initialAction = "build",
  initialFiles = [],
  disabled = false,
  settingsDisabled = false,
  modelLoading = false,
  mentionLoading = false,
  attachmentsDisabled = false,
  actionDisabled = false,
  submitLabel = "Start",
  submitLoading = false,
  submitDisabled = false,
  showAttachments = true,
  footerActions = <TaskPromptFooterActions />,
  footerNote = "Current: Codex (OpenAI) · GPT-5.5 · High"
}: {
  title: string;
  initialValue?: string;
  initialAction?: TaskPromptComposerAction;
  initialFiles?: SelectedTaskPromptImageFile[];
  disabled?: boolean;
  settingsDisabled?: boolean;
  modelLoading?: boolean;
  mentionLoading?: boolean;
  attachmentsDisabled?: boolean;
  actionDisabled?: boolean;
  submitLabel?: string;
  submitLoading?: boolean;
  submitDisabled?: boolean;
  showAttachments?: boolean;
  footerActions?: React.ReactNode;
  footerNote?: React.ReactNode;
}) {
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<SelectedTaskPromptImageFile[]>(initialFiles);
  const [action, setAction] = useState<TaskPromptComposerAction>(initialAction);
  const [model, setModel] = useState("gpt-5.5");

  return (
    <Flex vertical gap={8}>
      <Typography.Text strong>{title}</Typography.Text>
      <TaskPromptComposer
        value={value}
        onChange={setValue}
        placeholder="Describe the next implementation change for this branch"
        disabled={disabled}
        settingsDisabled={settingsDisabled}
        onOpenSettings={() => undefined}
        modelValue={model}
        modelOptions={taskPromptModelOptions}
        modelLoading={modelLoading}
        onModelChange={setModel}
        mentionOptions={taskPromptMentionOptions}
        mentionLoading={mentionLoading}
        onMentionSearch={() => undefined}
        attachments={files}
        onAttachmentsChange={setFiles}
        onAttachmentError={() => undefined}
        showAttachments={showAttachments}
        attachmentsDisabled={attachmentsDisabled}
        actionValue={action}
        actionOptions={taskPromptActionOptions}
        actionDisabled={actionDisabled}
        onActionChange={setAction}
        submitLabel={submitLabel}
        submitLoading={submitLoading}
        submitDisabled={submitDisabled}
        onSubmit={() => undefined}
        clearDisabled={disabled || (value.trim().length === 0 && files.length === 0)}
        onClear={() => {
          setValue("");
          setFiles([]);
        }}
        footerActions={footerActions}
        footerNote={
          footerNote ? (
            <Typography.Text type="secondary" style={{ display: "block", textAlign: "left" }}>
              {footerNote}
            </Typography.Text>
          ) : null
        }
      />
    </Flex>
  );
}

export const FooterNote: Story = {
  render: () => <AppFooterNote />
};

export const Sidebar: Story = {
  parameters: { verft: { pathname: "/tasks/task-storybook" } },
  render: () => (
    <div style={{ width: 320, height: 760 }}>
      <App>
        <AppSidebar pathname="/tasks/task-storybook" onNavigate={() => undefined} />
      </App>
    </div>
  )
};

export const BrowserNotifications: Story = {
  render: () => (
    <ComponentSurface>
      <TaskBrowserNotifications />
    </ComponentSurface>
  )
};

export const TaskCreateModalOpen: Story = {
  render: () => (
    <TaskCreateModal
      open
      onClose={() => undefined}
      onCreated={() => undefined}
      onUpdated={() => undefined}
    />
  )
};

export const TaskCreateModalDraft: Story = {
  render: () => (
    <TaskCreateModal
      open
      draftTask={createTask({ id: "task-draft", status: "draft", title: "Draft Storybook task" })}
      onClose={() => undefined}
      onCreated={() => undefined}
      onUpdated={() => undefined}
    />
  )
};

export const TaskDefinitionFieldsStandalone: Story = {
  render: () => {
    const [form] = Form.useForm<TaskDefinitionFormValues>();
    const [files, setFiles] = useState<SelectedTaskPromptImageFile[]>([]);
    return (
      <ComponentSurface>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...getTaskDefinitionInitialValues(settings, repositories[0], adminSession.user),
            title: "Document Storybook component states",
            prompt: "Create stories for page-level workflows and reusable components."
          }}
        >
          <TaskDefinitionFields form={form} promptImageFiles={files} onPromptImageFilesChange={setFiles} />
        </Form>
      </ComponentSurface>
    );
  }
};

export const PromptAttachments: Story = {
  render: () => {
    const initialFile = new File(["storybook"], "storybook.png", { type: "image/png", lastModified: 0 });
    const [files, setFiles] = useState<SelectedTaskPromptImageFile[]>([{ id: "storybook-file", file: initialFile }]);
    return (
      <ComponentSurface>
        <TaskPromptAttachmentsInput
          files={files}
          onChange={setFiles}
          onError={() => undefined}
          description="Attach visual context for an agent prompt."
        />
      </ComponentSurface>
    );
  }
};

export const TaskPromptEditor: Story = {
  render: () => {
    return (
      <ComponentSurface>
        <StatefulTaskPromptComposer
          title="Default with Git actions"
          initialFiles={[{ id: "diff-preview", file: createStoryImageFile("diff-preview.png") }]}
        />
      </ComponentSurface>
    );
  }
};

export const TaskPromptEditorStates: Story = {
  render: () => (
    <ComponentSurface>
      <Flex vertical gap={20}>
        <StatefulTaskPromptComposer
          title="Build with attachments and linked GitHub controls"
          initialFiles={[{ id: "mockup", file: createStoryImageFile("mockup.png") }]}
        />
        <StatefulTaskPromptComposer
          title="Ask is submitting"
          initialValue="Can you explain the current diff and list the riskiest files?"
          initialAction="ask"
          submitLabel="Ask"
          submitLoading
          footerActions={<TaskPromptFooterActions busy pushDisabled resetDisabled />}
          footerNote="Current: Codex (OpenAI) · GPT-5.5 · Medium · Request in progress"
        />
        <StatefulTaskPromptComposer
          title="Terminal selected"
          initialValue=""
          initialAction="terminal"
          submitLabel="Open Terminal"
          submitDisabled
          showAttachments={false}
          footerActions={<TaskPromptFooterActions pushDisabled resetDisabled />}
          footerNote="Current: Terminal mode · Prompt input is unavailable until a command can be started."
        />
        <StatefulTaskPromptComposer
          title="Interactive terminal running"
          initialValue="A terminal session is currently active."
          initialAction="build"
          disabled
          settingsDisabled
          attachmentsDisabled
          actionDisabled
          submitDisabled
          footerActions={<TaskPromptFooterActions busy pushDisabled resetDisabled moreLoading />}
          footerNote="Current: Codex (OpenAI) · GPT-5.5 · High · Settings will be applied on next run."
        />
        <StatefulTaskPromptComposer
          title="Model and file search loading"
          initialValue="Review @components"
          initialAction="comment"
          modelLoading
          mentionLoading
          submitLabel="Comment"
          footerActions={<TaskPromptFooterActions pushDisabled resetDisabled />}
        />
      </Flex>
    </ComponentSurface>
  )
};

export const HarnessMarkdown: Story = {
  render: () => {
    const [value, setValue] = useState("## Definition of done\n\n- Stories render\n- Typecheck passes");
    return (
      <ComponentSurface>
        <Flex vertical gap={8}>
          <Typography.Text strong>Harness instructions</Typography.Text>
          <HarnessMarkdownField label="Definition of done" value={value} onChange={setValue} />
        </Flex>
      </ComponentSurface>
    );
  }
};
