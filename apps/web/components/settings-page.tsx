"use client";

import { useEffect, useState } from "react";
import type { AgentProvider, McpServerTransport, SystemSettings } from "@agentswarm/shared-types";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Divider, Flex, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useSettings } from "../src/hooks/useSettings";

interface McpServerFormItem {
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  argsText?: string;
  url?: string;
  bearerTokenEnvVar?: string;
}

interface GeneralSettingsForm {
  defaultProvider: AgentProvider;
  maxAgents: number;
  branchPrefix: string;
  gitUsername: string;
  openaiBaseUrl: string;
  agentRules: string;
  mcpServers: McpServerFormItem[];
}

interface CredentialForm {
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

const transportOptions: Array<{ label: string; value: McpServerTransport }> = [
  { label: "stdio", value: "stdio" },
  { label: "http", value: "http" }
];

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" }
];

const toFormValues = (settings: SystemSettings): GeneralSettingsForm => ({
  defaultProvider: settings.defaultProvider,
  maxAgents: settings.maxAgents,
  branchPrefix: settings.branchPrefix,
  gitUsername: settings.gitUsername,
  openaiBaseUrl: settings.openaiBaseUrl ?? "",
  agentRules: settings.agentRules,
  mcpServers: settings.mcpServers.map((server) => ({
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? "",
    argsText: (server.args ?? []).join("\n"),
    url: server.url ?? "",
    bearerTokenEnvVar: server.bearerTokenEnvVar ?? ""
  }))
});

export function SettingsPage() {
  const { settings, loading } = useSettings();
  const [generalForm] = Form.useForm<GeneralSettingsForm>();
  const [credentialForm] = Form.useForm<CredentialForm>();
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (!settings) {
      return;
    }

    generalForm.setFieldsValue(toFormValues(settings));
  }, [generalForm, settings]);

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Settings
          </Typography.Title>
          <Typography.Text type="secondary">
            Concurrency, branch defaults, provider rules, MCP servers, and provider credentials.
          </Typography.Text>
        </Flex>

        <Form
          form={generalForm}
          layout="vertical"
          onFinish={async (values) => {
            setSavingGeneral(true);
            try {
              await api.updateSettings({
                defaultProvider: values.defaultProvider,
                maxAgents: values.maxAgents,
                branchPrefix: values.branchPrefix,
                gitUsername: values.gitUsername,
                openaiBaseUrl: values.openaiBaseUrl?.trim() ? values.openaiBaseUrl.trim() : null,
                agentRules: values.agentRules ?? "",
                mcpServers: (values.mcpServers ?? []).map((server) =>
                  server.transport === "http"
                    ? {
                        name: server.name,
                        enabled: server.enabled,
                        transport: "http" as const,
                        url: server.url?.trim() || "",
                        bearerTokenEnvVar: server.bearerTokenEnvVar?.trim() || null
                      }
                    : {
                        name: server.name,
                        enabled: server.enabled,
                        transport: "stdio" as const,
                        command: server.command?.trim() || "",
                        args:
                          server.argsText
                            ?.split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean) ?? []
                      }
                )
              });
              messageApi.success("Settings saved");
            } finally {
              setSavingGeneral(false);
            }
          }}
        >
          <Card bordered={false} loading={loading}>
            <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 560 }}>
              <Form.Item name="defaultProvider" label="Default Provider" rules={[{ required: true }]}>
                <Select options={providerOptions} />
              </Form.Item>
              <Form.Item name="maxAgents" label="Max Agents" rules={[{ required: true }]}>
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="branchPrefix"
                label="Feature Branch Prefix"
                rules={[{ required: true, whitespace: true, message: "Enter a branch prefix" }]}
                extra="Used for generated feature branches, for example agentswarm/my-task-1234abcd."
              >
                <Input placeholder="agentswarm" />
              </Form.Item>
              <Form.Item
                name="gitUsername"
                label="Git Username"
                rules={[{ required: true, whitespace: true, message: "Enter a git username" }]}
                extra="Used together with the stored git token for HTTPS clone/push. For GitHub PAT auth, x-access-token is usually correct."
              >
                <Input placeholder="x-access-token" />
              </Form.Item>
              <Form.Item
                name="openaiBaseUrl"
                label="OpenAI Base URL"
                extra="Optional. Leave blank to use the default OpenAI API endpoint."
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
            </Space>
          </Card>

          <Card bordered={false} loading={loading} title="Agent Rules" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={12} style={{ width: "100%", maxWidth: 900 }}>
              <Alert
                type="info"
                showIcon
                message="Applied on every agent spawn"
                description="These rules are injected into every plan, build, review, ask, and iterate prompt before the selected provider runs."
              />
              <Form.Item
                name="agentRules"
                label="Global Agent Rules"
                extra="Use this for repository-wide instructions like architecture constraints, testing expectations, or coding policies."
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea
                  rows={10}
                  placeholder={"- Prefer pnpm over npm\n- Run unit tests before finalizing\n- Never change generated files by hand"}
                />
              </Form.Item>
            </Space>
          </Card>

          <Card bordered={false} loading={loading} title="MCP Servers" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message="Rendered into provider runtime config"
                description="Each spawned agent gets a generated provider-specific MCP config. To avoid exposing credentials, the UI only supports command and args for stdio servers and bearer-token env-var references for HTTP servers."
              />

              <Form.List name="mcpServers">
                {(fields, { add, remove }) => (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    {fields.map((field) => {
                      return (
                        <Card
                          key={field.key}
                          size="small"
                          title={`Server ${field.name + 1}`}
                          extra={
                            <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                              Remove
                            </Button>
                          }
                        >
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            <Form.Item
                              name={[field.name, "name"]}
                              label="Name"
                              rules={[{ required: true, whitespace: true, message: "Enter a server name" }]}
                            >
                              <Input placeholder="memory" />
                            </Form.Item>

                            <Form.Item name={[field.name, "enabled"]} label="Enabled" valuePropName="checked">
                              <Switch />
                            </Form.Item>

                            <Form.Item
                              name={[field.name, "transport"]}
                              label="Transport"
                              rules={[{ required: true, message: "Select a transport" }]}
                            >
                              <Select options={transportOptions} />
                            </Form.Item>

                            <Form.Item noStyle shouldUpdate>
                              {() => {
                                const transport = generalForm.getFieldValue(["mcpServers", field.name, "transport"]) ?? "stdio";

                                return transport === "http" ? (
                                  <>
                                    <Form.Item
                                      name={[field.name, "url"]}
                                      label="URL"
                                      rules={[{ required: true, whitespace: true, message: "Enter the MCP server URL" }]}
                                    >
                                      <Input placeholder="https://example.com/mcp" />
                                    </Form.Item>
                                    <Form.Item
                                      name={[field.name, "bearerTokenEnvVar"]}
                                      label="Bearer Token Env Var"
                                      extra="Optional. If set, AgentSwarm will reference this env var in the generated provider config and pass it through only if it already exists in the server container environment."
                                    >
                                      <Input placeholder="MY_MCP_TOKEN" />
                                    </Form.Item>
                                  </>
                                ) : (
                                  <>
                                    <Form.Item
                                      name={[field.name, "command"]}
                                      label="Command"
                                      rules={[{ required: true, whitespace: true, message: "Enter the stdio command" }]}
                                    >
                                      <Input placeholder="docker" />
                                    </Form.Item>
                                    <Form.Item
                                      name={[field.name, "argsText"]}
                                      label="Arguments"
                                      extra="One argument per line. Example: run, -i, --rm, my-mcp-image"
                                    >
                                      <Input.TextArea rows={6} placeholder={"run\n-i\n--rm\nmcp/memory"} />
                                    </Form.Item>
                                  </>
                                );
                              }}
                            </Form.Item>
                          </Space>
                        </Card>
                      );
                    })}

                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        add({
                          name: "",
                          enabled: true,
                          transport: "stdio",
                          command: "",
                          argsText: ""
                        })
                      }
                    >
                      Add MCP Server
                    </Button>
                  </Space>
                )}
              </Form.List>

            </Space>
          </Card>

          <Flex justify="flex-start" style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={savingGeneral}>
              Save Settings
            </Button>
          </Flex>
        </Form>

        <Divider />

        <Card
          bordered={false}
          loading={loading}
          title="Credentials"
          extra={
            settings ? (
              <Space>
                <Tag color={settings.githubTokenConfigured ? "green" : "default"}>
                  GitHub Token {settings.githubTokenConfigured ? "Configured" : "Missing"}
                </Tag>
                <Tag color={settings.openaiApiKeyConfigured ? "green" : "default"}>
                  OpenAI API Key {settings.openaiApiKeyConfigured ? "Configured" : "Missing"}
                </Tag>
                <Tag color={settings.anthropicApiKeyConfigured ? "green" : "default"}>
                  Anthropic API Key {settings.anthropicApiKeyConfigured ? "Configured" : "Missing"}
                </Tag>
              </Space>
            ) : null
          }
        >
          <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 520 }}>
            <Alert
              type="info"
              showIcon
              message="Credentials are write-only"
              description="Tokens are encrypted on the server with a local key volume. They are never returned by the API or rendered back into the UI."
            />

            <Form
              form={credentialForm}
              layout="vertical"
              onFinish={async (values) => {
                setSavingCredentials(true);
                try {
                  await api.updateCredentials({
                    githubToken: values.githubToken?.trim() || undefined,
                    openaiApiKey: values.openaiApiKey?.trim() || undefined,
                    anthropicApiKey: values.anthropicApiKey?.trim() || undefined
                  });
                  credentialForm.resetFields();
                  messageApi.success("Credentials updated");
                } finally {
                  setSavingCredentials(false);
                }
              }}
            >
              <Form.Item
                name="githubToken"
                label="GitHub Token"
                extra="Used for GitHub API imports and Git operations against private GitHub repositories."
              >
                <Input.Password
                  placeholder={settings?.githubTokenConfigured ? "Configured. Enter a new token to replace it." : "github_pat_..."}
                />
              </Form.Item>
              <Form.Item
                name="openaiApiKey"
                label="OpenAI API Key"
                extra="Used by Codex runtime containers."
              >
                <Input.Password
                  placeholder={settings?.openaiApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-..."}
                />
              </Form.Item>
              <Form.Item
                name="anthropicApiKey"
                label="Anthropic API Key"
                extra="Used by runtime containers to authenticate Claude Code."
              >
                <Input.Password
                  placeholder={settings?.anthropicApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-ant-..."}
                />
              </Form.Item>
              <Space wrap>
                <Button type="primary" htmlType="submit" loading={savingCredentials}>
                  Save Credentials
                </Button>
                <Button
                  danger
                  loading={savingCredentials}
                  onClick={async () => {
                    setSavingCredentials(true);
                    try {
                      await api.updateCredentials({ clearGithubToken: true });
                      credentialForm.resetFields(["githubToken"]);
                      messageApi.success("GitHub token cleared");
                    } finally {
                      setSavingCredentials(false);
                    }
                  }}
                >
                  Clear GitHub Token
                </Button>
                <Button
                  danger
                  loading={savingCredentials}
                  onClick={async () => {
                    setSavingCredentials(true);
                    try {
                      await api.updateCredentials({ clearOpenAiApiKey: true });
                      credentialForm.resetFields(["openaiApiKey"]);
                      messageApi.success("OpenAI API key cleared");
                    } finally {
                      setSavingCredentials(false);
                    }
                  }}
                >
                  Clear OpenAI API Key
                </Button>
                <Button
                  danger
                  loading={savingCredentials}
                  onClick={async () => {
                    setSavingCredentials(true);
                    try {
                      await api.updateCredentials({ clearAnthropicApiKey: true });
                      credentialForm.resetFields(["anthropicApiKey"]);
                      messageApi.success("Anthropic API key cleared");
                    } finally {
                      setSavingCredentials(false);
                    }
                  }}
                >
                  Clear Anthropic API Key
                </Button>
              </Space>
            </Form>
          </Space>
        </Card>
      </Space>
    </>
  );
}
