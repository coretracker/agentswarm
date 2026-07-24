import type { Meta, StoryObj } from "@storybook/react";
import { AppShell } from "./app-shell";
import { HomePage } from "./home-page";
import { LoginPage } from "./login-page";
import { ProfilePage } from "./profile-page";
import { RepositoriesPage } from "./repositories-page";
import { RepositoryEditorPage } from "./repository-editor-page";
import { SettingsPage } from "./settings-page";
import { TaskCreatePage } from "./task-create-page";
import { TaskDetailPage } from "./task-detail-page";
import { TaskTerminalPage } from "./task-terminal-page";
import { TasksPage } from "./tasks-page";
import { UsersPage } from "./users-page";
import { repositories, tasks, viewerSession } from "../.storybook/fixtures";

function ShellPage({ children = null }: { children?: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

const meta = {
  title: "Pages/App",
  component: ShellPage,
  parameters: {
    layout: "fullscreen",
    verft: { shell: "fullscreen", pathname: "/tasks" }
  },
  args: {
    children: null
  }
} satisfies Meta<typeof ShellPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeRedirect: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/" } },
  render: () => <HomePage />
};

export const Login: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/login", session: null } },
  render: () => (
    <ShellPage>
      <LoginPage />
    </ShellPage>
  )
};

export const TasksActive: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks" } },
  render: () => (
    <ShellPage>
      <TasksPage />
    </ShellPage>
  )
};

export const TasksArchived: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks", search: { view: "archived" } } },
  render: () => (
    <ShellPage>
      <TasksPage />
    </ShellPage>
  )
};

export const TasksReadOnly: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks", session: viewerSession } },
  render: () => (
    <ShellPage>
      <TasksPage />
    </ShellPage>
  )
};

export const NewTask: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks/new" } },
  render: () => (
    <ShellPage>
      <TaskCreatePage />
    </ShellPage>
  )
};

export const TaskDetailPendingCheckpoint: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: `/tasks/${tasks[0].id}` } },
  render: () => (
    <ShellPage>
      <TaskDetailPage taskId={tasks[0].id} />
    </ShellPage>
  )
};

export const TaskDetailRunning: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks/task-running" } },
  render: () => (
    <ShellPage>
      <TaskDetailPage taskId="task-running" />
    </ShellPage>
  )
};

export const TaskDetailPreparingWorkspace: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/tasks/task-preparing" } },
  render: () => (
    <ShellPage>
      <TaskDetailPage taskId="task-preparing" />
    </ShellPage>
  )
};

export const TaskTerminal: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: `/tasks/${tasks[0].id}/terminal`, params: { id: tasks[0].id } } },
  render: () => (
    <ShellPage>
      <TaskTerminalPage taskId={tasks[0].id} />
    </ShellPage>
  )
};

export const Repositories: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/repositories" } },
  render: () => (
    <ShellPage>
      <RepositoriesPage />
    </ShellPage>
  )
};

export const NewRepository: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/repositories/new" } },
  render: () => (
    <ShellPage>
      <RepositoryEditorPage mode="create" />
    </ShellPage>
  )
};

export const EditRepository: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: `/repositories/${repositories[0].id}/edit` } },
  render: () => (
    <ShellPage>
      <RepositoryEditorPage mode="edit" repositoryId={repositories[0].id} />
    </ShellPage>
  )
};

export const Settings: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/settings" } },
  render: () => (
    <ShellPage>
      <SettingsPage />
    </ShellPage>
  )
};

export const Users: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/users" } },
  render: () => (
    <ShellPage>
      <UsersPage />
    </ShellPage>
  )
};

export const Profile: Story = {
  parameters: { verft: { shell: "fullscreen", pathname: "/profile" } },
  render: () => (
    <ShellPage>
      <ProfilePage />
    </ShellPage>
  )
};
