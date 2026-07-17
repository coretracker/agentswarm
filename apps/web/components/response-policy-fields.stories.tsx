import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Card, Form } from "antd";
import { ResponsePolicyFields } from "./response-policy-fields";

function ResponsePolicyFieldsDemo() {
  const [form] = Form.useForm();

  return (
    <Card title="Response Policy" style={{ maxWidth: 620 }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          audience: "technical",
          explanationDepth: "standard",
          jargonLevel: "balanced",
          formattingStyle: "checklist"
        }}
      >
        <ResponsePolicyFields />
      </Form>
    </Card>
  );
}

const meta = {
  title: "Components/ResponsePolicyFields",
  component: ResponsePolicyFields,
  tags: ["autodocs"],
  render: () => <ResponsePolicyFieldsDemo />
} satisfies Meta<typeof ResponsePolicyFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMockDefaults: Story = {};
