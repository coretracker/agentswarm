import type { Meta, StoryObj } from "@storybook/react";
import { Result, Typography } from "antd";
import { AppShell } from "./app-shell";
import { adminSession, viewerSession } from "../.storybook/fixtures";

const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
    verft: { shell: "fullscreen", pathname: "/tasks" }
  },
  args: {
    children: null
  }
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AuthenticatedDesktop: Story = {
  render: () => (
    <AppShell>
      <Typography.Title level={2}>Task workspace</Typography.Title>
      <Typography.Paragraph type="secondary">
        Main content renders inside the authenticated Verft shell with global navigation and sidebar.
      </Typography.Paragraph>
    </AppShell>
  )
};

export const PublicLoginPath: Story = {
  parameters: {
    verft: { shell: "fullscreen", pathname: "/login", session: null }
  },
  render: () => (
    <AppShell>
      <Result title="Public route" subTitle="The shell does not require a session on public routes." />
    </AppShell>
  )
};

export const ForbiddenRoute: Story = {
  parameters: {
    verft: { shell: "fullscreen", pathname: "/settings", session: viewerSession }
  },
  render: () => (
    <AppShell>
      <Typography.Text>This content is replaced by a 403 state for the viewer session.</Typography.Text>
    </AppShell>
  )
};

export const TerminalFullscreen: Story = {
  parameters: {
    verft: { shell: "fullscreen", pathname: "/tasks/task-storybook/terminal", session: adminSession }
  },
  render: () => (
    <AppShell>
      <div style={{ height: "100%", minHeight: 360, background: "#1e1e1e" }} />
    </AppShell>
  )
};
