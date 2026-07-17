import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Space } from "antd";
import { AppFooterNote } from "./app-footer-note";
import { AppLogo } from "./app-logo";

const meta = {
  title: "Components/AppLogo",
  component: AppLogo,
  tags: ["autodocs"],
  args: {
    width: 280,
    height: "auto"
  }
} satisfies Meta<typeof AppLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFooterNote: Story = {
  render: (args) => (
    <Space direction="vertical" size={20} align="center">
      <AppLogo {...args} />
      <AppFooterNote />
    </Space>
  )
};
