"use client";

import { useEffect, useState } from "react";
import type { AgentProvider, McpServerTransport, PermissionScope, ProviderProfile, Role, SystemSettings } from "@agentswarm/shared-types";
import { PERMISSION_SCOPE_GROUPS, getEffortOptionsForProvider } from "@agentswarm/shared-types";
import { DeleteOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
import { api } from "../src/api/client";
import { useSettings } from "../src/hooks/useSettings";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { useAuth } from "./auth-provider";

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
  codexDefaultModel: string;
  codexDefaultEffort: ProviderProfile;
  claudeDefaultModel: string;
  claudeDefaultEffort: ProviderProfile;
}

interface CredentialForm {
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

interface RoleFormValues {
  name: string;
  description: string;
  scopes: PermissionScope[];
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
  })),
  codexDefaultModel: settings.codexDefaultModel,
  codexDefaultEffort: settings.codexDefaultEffort,
  claudeDefaultModel: settings.claudeDefaultModel,
  claudeDefaultEffort: settings.claudeDefaultEffort
});

export function SettingsPage() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const { loading, setSettings, settings } = useSettings();
  const [generalForm] = Form.useForm<GeneralSettingsForm>();
  const [credentialForm] = Form.useForm<CredentialForm>();
  const [roleForm] = Form.useForm<RoleFormValues>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const canEditSettings = can("settings:edit");
  const { models: codexModels, loading: codexModelsLoading } = useProviderModels("codex");
  const { models: claudeModels, loading: claudeModelsLoading } = useProviderModels("claude");

  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      setRoles(await api.listRoles());
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    if (!settings) {
      return;
    }

    generalForm.setFieldsValue(toFormValues(settings));
  }, [generalForm, settings]);

  useEffect(() => {
    void loadRoles();
  }, []);

  return (
    <>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Settings
          </Typography.Title>
          <Typography.Text type="secondary">
            Concurrency, runtime defaults, provider credentials, and role-based access control.
          </Typography.Text>
        </Flex>

        {!canEditSettings ? (
          <Alert
            type="info"
            showIcon
            message="Read-only access"
            description="This account can view system configuration and roles, but it cannot change them."
          />
        ) : null}

        <Form
          form={generalForm}
          layout="vertical"
          disabled={!canEditSettings}
          onFinish={async (values) => {
            setSavingGeneral(true);
            try {
              const nextSettings = await api.updateSettings({
                defaultProvider: values.defaultProvider,
                maxAgents: values.maxAgents,
                branchPrefix: values.branchPrefix,
                gitUsername: values.gitUsername,
                openaiBaseUrl: values.openaiBaseUrl?.trim() ? values.openaiBaseUrl.trim() : null,
                agentRules: values.agentRules ?? "",
                codexDefaultModel: values.codexDefaultModel,
                codexDefaultEffort: values.codexDefaultEffort,
                claudeDefaultModel: values.claudeDefaultModel,
                claudeDefaultEffort: values.claudeDefaultEffort,
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
              setSettings(nextSettings);
              message.success("Settings saved");
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Failed to save settings");
            } finally {
              setSavingGeneral(false);
            }
          }}
        >
          <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 720 }}>
            <Card bordered={false} loading={loading} title="AI Provider Settings">
              <Space direction="vertical" size={24} style={{ width: "100%" }}>
                <div>
                  <Typography.Text strong>Runtime Defaults</Typography.Text>
                  <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item name="defaultProvider" label="Default Provider" rules={[{ required: true }]}>
                      <Select options={providerOptions} />
                    </Form.Item>
                    <Form.Item
                      name="maxAgents"
                      label="Concurrent Agents"
                      extra="Hard limit on how many agents can run in parallel."
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1} max={20} style={{ width: "100%" }} />
                    </Form.Item>
                  </Space>
                </div>

                <div>
                  <Typography.Text strong>Provider API</Typography.Text>
                  <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item
                      name="openaiBaseUrl"
                      label="OpenAI Base URL"
                      extra="Override when pointing to a proxy or self-hosted gateway."
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                  </Space>
                </div>

                <div>
                  <Typography.Text strong>Codex (OpenAI)</Typography.Text>
                  <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item name="codexDefaultModel" label="Default Model" style={{ marginBottom: 0 }}>
                      <Select
                        options={codexModels}
                        loading={codexModelsLoading}
                        showSearch
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    <Form.Item name="codexDefaultEffort" label="Default Reasoning Effort" style={{ marginBottom: 0 }}>
                      <Select options={getEffortOptionsForProvider("codex")} />
                    </Form.Item>
                  </Space>
                </div>

                <div>
                  <Typography.Text strong>Claude Code (Anthropic)</Typography.Text>
                  <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
                    <Form.Item name="claudeDefaultModel" label="Default Model" style={{ marginBottom: 0 }}>
                      <Select
                        options={claudeModels}
                        loading={claudeModelsLoading}
                        showSearch
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    <Form.Item name="claudeDefaultEffort" label="Default Max Turns" style={{ marginBottom: 0 }}>
                      <Select options={getEffortOptionsForProvider("claude")} />
                    </Form.Item>
                  </Space>
                </div>
              </Space>
            </Card>

            <Card bordered={false} loading={loading} title="Git & Branching">
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Form.Item name="branchPrefix" label="Feature Branch Prefix" rules={[{ required: true, whitespace: true }]}>
                  <Input placeholder="agentswarm" />
                </Form.Item>
                <Form.Item
                  name="gitUsername"
                  label="Git Username"
                  extra="Used for authenticated pushes from the runtime."
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="x-access-token" />
                </Form.Item>
              </Space>
            </Card>
          </Space>

          <Card bordered={false} loading={loading} title="Agent Rules" style={{ marginTop: 16 }}>
            <Form.Item
              name="agentRules"
              label="Global Agent Rules"
              extra="Applied to every plan, build, review, ask, and iterate run."
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea
                rows={10}
                placeholder={"- Prefer pnpm over npm\n- Run unit tests before finalizing\n- Never change generated files by hand"}
              />
            </Form.Item>
          </Card>

          <Card bordered={false} loading={loading} title="MCP Servers" style={{ marginTop: 16 }}>
            <Form.List name="mcpServers">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`Server ${field.name + 1}`}
                      extra={
                        <Button
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          disabled={!canEditSettings}
                          onClick={() => remove(field.name)}
                        >
                          Remove
                        </Button>
                      }
                    >
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Form.Item name={[field.name, "name"]} label="Name" rules={[{ required: true, whitespace: true }]}>
                          <Input placeholder="memory" />
                        </Form.Item>
                        <Form.Item name={[field.name, "enabled"]} label="Enabled" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Form.Item name={[field.name, "transport"]} label="Transport" rules={[{ required: true }]}>
                          <Select options={transportOptions} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate>
                          {() => {
                            const transport = generalForm.getFieldValue(["mcpServers", field.name, "transport"]) ?? "stdio";
                            return transport === "http" ? (
                              <>
                                <Form.Item name={[field.name, "url"]} label="URL" rules={[{ required: true, whitespace: true }]}>
                                  <Input placeholder="https://example.com/mcp" />
                                </Form.Item>
                                <Form.Item name={[field.name, "bearerTokenEnvVar"]} label="Bearer Token Env Var">
                                  <Input placeholder="MY_MCP_TOKEN" />
                                </Form.Item>
                              </>
                            ) : (
                              <>
                                <Form.Item name={[field.name, "command"]} label="Command" rules={[{ required: true, whitespace: true }]}>
                                  <Input placeholder="docker" />
                                </Form.Item>
                                <Form.Item name={[field.name, "argsText"]} label="Arguments">
                                  <Input.TextArea rows={6} placeholder={"run\n-i\n--rm\nmcp/memory"} />
                                </Form.Item>
                              </>
                            );
                          }}
                        </Form.Item>
                      </Space>
                    </Card>
                  ))}

                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    disabled={!canEditSettings}
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
          </Card>

          <Flex justify="flex-start" style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={savingGeneral} disabled={!canEditSettings}>
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
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Credentials are write-only"
            description="Tokens are encrypted on the server and never returned by the API."
          />
          <Form
            form={credentialForm}
            layout="vertical"
            disabled={!canEditSettings}
            onFinish={async (values) => {
              setSavingCredentials(true);
              try {
                const nextSettings = await api.updateCredentials({
                  githubToken: values.githubToken?.trim() || undefined,
                  openaiApiKey: values.openaiApiKey?.trim() || undefined,
                  anthropicApiKey: values.anthropicApiKey?.trim() || undefined
                });
                credentialForm.resetFields();
                setSettings(nextSettings);
                message.success("Credentials updated");
              } catch (error) {
                message.error(error instanceof Error ? error.message : "Failed to update credentials");
              } finally {
                setSavingCredentials(false);
              }
            }}
          >
            <Form.Item name="githubToken" label="GitHub Token">
              <Input.Password placeholder={settings?.githubTokenConfigured ? "Configured. Enter a new token to replace it." : "github_pat_..."} />
            </Form.Item>
            <Form.Item name="openaiApiKey" label="OpenAI API Key">
              <Input.Password placeholder={settings?.openaiApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-..."} />
            </Form.Item>
            <Form.Item name="anthropicApiKey" label="Anthropic API Key">
              <Input.Password placeholder={settings?.anthropicApiKeyConfigured ? "Configured. Enter a new key to replace it." : "sk-ant-..."} />
            </Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={savingCredentials} disabled={!canEditSettings}>
                Save Credentials
              </Button>
              <Button
                danger
                loading={savingCredentials}
                disabled={!canEditSettings}
                onClick={async () => {
                  setSavingCredentials(true);
                  try {
                    const nextSettings = await api.updateCredentials({ clearGithubToken: true });
                    setSettings(nextSettings);
                    credentialForm.resetFields(["githubToken"]);
                    message.success("GitHub token cleared");
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Failed to clear GitHub token");
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
                disabled={!canEditSettings}
                onClick={async () => {
                  setSavingCredentials(true);
                  try {
                    const nextSettings = await api.updateCredentials({ clearOpenAiApiKey: true });
                    setSettings(nextSettings);
                    credentialForm.resetFields(["openaiApiKey"]);
                    message.success("OpenAI API key cleared");
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Failed to clear OpenAI API key");
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
                disabled={!canEditSettings}
                onClick={async () => {
                  setSavingCredentials(true);
                  try {
                    const nextSettings = await api.updateCredentials({ clearAnthropicApiKey: true });
                    setSettings(nextSettings);
                    credentialForm.resetFields(["anthropicApiKey"]);
                    message.success("Anthropic API key cleared");
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Failed to clear Anthropic API key");
                  } finally {
                    setSavingCredentials(false);
                  }
                }}
              >
                Clear Anthropic API Key
              </Button>
            </Space>
          </Form>
        </Card>

        <Card
          bordered={false}
          loading={rolesLoading}
          title="Roles"
          extra={
            <Button
              type="primary"
              disabled={!canEditSettings}
              onClick={() => {
                setEditingRole(null);
                roleForm.setFieldsValue({ name: "", description: "", scopes: [] });
                setRoleModalOpen(true);
              }}
            >
              Add Role
            </Button>
          }
        >
          <Table<Role>
            rowKey="id"
            pagination={false}
            dataSource={roles}
            columns={[
              {
                title: "Name",
                dataIndex: "name",
                render: (value: string, role) => (
                  <Space>
                    <Typography.Text strong>{value}</Typography.Text>
                    {role.isSystem ? <Tag icon={<LockOutlined />}>System</Tag> : null}
                  </Space>
                )
              },
              {
                title: "Description",
                dataIndex: "description",
                render: (value: string) => value || <Typography.Text type="secondary">None</Typography.Text>
              },
              {
                title: "Scopes",
                render: (_, role) => (
                  <Space size={[4, 4]} wrap>
                    {role.scopes.map((scope) => (
                      <Tag key={scope}>{scope}</Tag>
                    ))}
                  </Space>
                )
              },
              {
                title: "Actions",
                render: (_, role) => (
                  <Space>
                    <Button
                      disabled={!canEditSettings || role.isSystem}
                      onClick={() => {
                        setEditingRole(role);
                        roleForm.setFieldsValue({
                          name: role.name,
                          description: role.description,
                          scopes: role.scopes
                        });
                        setRoleModalOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      danger
                      disabled={!canEditSettings || role.isSystem}
                      onClick={async () => {
                        try {
                          await api.deleteRole(role.id);
                          message.success("Role deleted");
                          await loadRoles();
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : "Failed to delete role");
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Space>

      <Modal
        open={roleModalOpen}
        title={editingRole ? `Edit Role: ${editingRole.name}` : "Add Role"}
        footer={null}
        onCancel={() => setRoleModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={roleForm}
          layout="vertical"
          onFinish={async (values) => {
            setSavingRole(true);
            try {
              if (editingRole) {
                await api.updateRole(editingRole.id, values);
                message.success("Role updated");
              } else {
                await api.createRole(values);
                message.success("Role created");
              }

              setRoleModalOpen(false);
              await loadRoles();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Failed to save role");
            } finally {
              setSavingRole(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a role name" }]}>
            <Input disabled={!canEditSettings || editingRole?.isSystem} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} disabled={!canEditSettings || editingRole?.isSystem} />
          </Form.Item>
          <Form.Item name="scopes" hidden rules={[{ required: true, message: "Select at least one scope" }]}>
            <Select mode="multiple" options={[]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const selectedScopes = (roleForm.getFieldValue("scopes") ?? []) as PermissionScope[];
              return (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {PERMISSION_SCOPE_GROUPS.map((group) => (
                    <Card key={group.label} size="small" title={group.label}>
                      <Checkbox.Group
                        style={{ width: "100%" }}
                        disabled={!canEditSettings || editingRole?.isSystem}
                        value={group.scopes.filter((scope) => selectedScopes.includes(scope))}
                        options={group.scopes.map((scope) => ({
                          label: scope,
                          value: scope
                        }))}
                        onChange={(checkedValues) => {
                          const currentScopes = (roleForm.getFieldValue("scopes") ?? []) as PermissionScope[];
                          const groupScopeSet = new Set(group.scopes);
                          const otherScopes = currentScopes.filter((scope) => !groupScopeSet.has(scope));
                          roleForm.setFieldValue("scopes", [...otherScopes, ...(checkedValues as PermissionScope[])]);
                        }}
                      />
                    </Card>
                  ))}
                </Space>
              );
            }}
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={savingRole}
            disabled={!canEditSettings || editingRole?.isSystem}
            block
            style={{ marginTop: 16 }}
          >
            {editingRole ? "Save Role" : "Create Role"}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
