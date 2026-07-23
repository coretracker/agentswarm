import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { App, Flex, Form, Typography } from "antd";
import type { TaskDefinitionFormValues } from "./task-definition-fields";
import { AppFooterNote } from "./app-footer-note";
import { AppSidebar } from "./app-sidebar";
import { HarnessMarkdownField } from "./harness-markdown-field";
import { TaskBrowserNotifications } from "./task-browser-notifications";
import { TaskCreateModal } from "./task-create-modal";
import { TaskDefinitionFields, getTaskDefinitionInitialValues } from "./task-definition-fields";
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
