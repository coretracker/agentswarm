"use client";

import { useMemo } from "react";
import type { FormInstance } from "antd";
import { Card, Divider, Form, Input, Select } from "antd";
import type { AgentProvider, ProviderProfile } from "@verft/shared-types";
import { getAgentProviderLabel, getEffortOptionsForProvider, getModelsForProvider } from "@verft/shared-types";
import { ModelSelect } from "./model-select";

export interface UserProfileFormValues {
  name: string;
  githubUsername?: string;
  defaultProvider?: AgentProvider;
  defaultModel?: string;
  defaultProviderProfile?: ProviderProfile;
}

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: getAgentProviderLabel("codex"), value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

export function UserProfileFields({ form }: { form: FormInstance }) {
  const selectedDefaultProvider = (Form.useWatch("defaultProvider", form) as AgentProvider | undefined) ?? "codex";
  const defaultModelOptions = useMemo(() => getModelsForProvider(selectedDefaultProvider), [selectedDefaultProvider]);
  const defaultEffortOptions = useMemo(() => getEffortOptionsForProvider(selectedDefaultProvider), [selectedDefaultProvider]);

  return (
    <>
      <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a user name" }]}>
        <Input />
      </Form.Item>
      <Form.Item
        name="githubUsername"
        label="GitHub Username"
        extra="Used to associate this user with GitHub activity."
        rules={[{ max: 80, message: "GitHub username must be 80 characters or fewer." }]}
      >
        <Input autoComplete="off" placeholder="octocat" />
      </Form.Item>
      <Divider orientation="left" plain>
        Default Agent
      </Divider>
      <Card size="small">
        <Form.Item name="defaultProvider" label="Provider">
          <Select
            allowClear
            placeholder="Repository or system default"
            options={providerOptions}
            onChange={(value: AgentProvider | undefined) => {
              const nextEfforts = getEffortOptionsForProvider(value ?? "codex");
              if (!nextEfforts.some((option) => option.value === form.getFieldValue("defaultProviderProfile"))) {
                form.setFieldValue("defaultProviderProfile", undefined);
              }
            }}
          />
        </Form.Item>
        <Form.Item name="defaultModel" label="Model">
          <ModelSelect options={defaultModelOptions} placeholder="Repository or system default" />
        </Form.Item>
        <Form.Item name="defaultProviderProfile" label="Effort">
          <Select allowClear options={defaultEffortOptions} placeholder="Repository or system default" />
        </Form.Item>
      </Card>
    </>
  );
}
