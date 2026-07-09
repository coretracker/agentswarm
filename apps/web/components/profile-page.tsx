"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Divider, Flex, Form, Input, Select, Space, Spin, Tag, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { api } from "../src/api/client";
import type { AssistantEvent, AssistantSession } from "../src/api/client";
import { useAuth } from "./auth-provider";
import { ResponsePolicyFields } from "./response-policy-fields";
import { ModelSelect } from "./model-select";
import type {
  AgentClarifyBehavior,
  AgentCodePreference,
  AgentExplanationDepth,
  AgentFormattingStyle,
  AgentJargonLevel,
  AgentProvider,
  AudienceType,
  PersonalAccessToken,
  ProviderProfile
} from "@verft/shared-types";
import { getAgentProviderLabel, getEffortOptionsForProvider, getModelsForProvider } from "@verft/shared-types";

const MCP_PROFILE_TOKEN_NAME = "Verft MCP";

const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: getAgentProviderLabel("codex"), value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
};

export function ProfilePage() {
  const { message } = App.useApp();
  const { session, setSessionUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personalAccessTokens, setPersonalAccessTokens] = useState<PersonalAccessToken[]>([]);
  const [personalAccessTokenLoading, setPersonalAccessTokenLoading] = useState(true);
  const [generatedPersonalAccessToken, setGeneratedPersonalAccessToken] = useState<string | null>(null);
  const [assistantSessions, setAssistantSessions] = useState<AssistantSession[]>([]);
  const [assistantEvents, setAssistantEvents] = useState<AssistantEvent[]>([]);
  const [clearingAssistantSession, setClearingAssistantSession] = useState(false);
  const [form] = Form.useForm<{
    name: string;
    githubUsername?: string;
    slackTeamId?: string;
    slackUserId?: string;
    defaultProvider?: AgentProvider;
    defaultModel?: string;
    defaultProviderProfile?: ProviderProfile;
    audience?: AudienceType;
    explanationDepth?: AgentExplanationDepth;
    jargonLevel?: AgentJargonLevel;
    codePreference?: AgentCodePreference;
    clarifyBehavior?: AgentClarifyBehavior;
    formattingStyle?: AgentFormattingStyle;
    extraInstructions?: string;
  }>();

  const selectedDefaultProvider = (Form.useWatch("defaultProvider", form) as AgentProvider | undefined) ?? "codex";
  const defaultModelOptions = useMemo(() => getModelsForProvider(selectedDefaultProvider), [selectedDefaultProvider]);
  const defaultEffortOptions = useMemo(() => getEffortOptionsForProvider(selectedDefaultProvider), [selectedDefaultProvider]);

  const activeMcpTokens = personalAccessTokens.filter((token) => token.name === MCP_PROFILE_TOKEN_NAME && !token.revokedAt);
  const currentMcpToken = activeMcpTokens[0] ?? null;

  useEffect(() => {
    void Promise.all([api.getProfile(), api.listPersonalAccessTokens(), api.getSlackIdentity(), api.listAssistantSessions()])
      .then(([profile, tokens, slackIdentity, sessions]) => {
        form.setFieldsValue({
          name: profile.name,
          githubUsername: profile.githubUsername ?? "",
          slackTeamId: slackIdentity?.slackTeamId ?? "",
          slackUserId: slackIdentity?.slackUserId ?? "",
          defaultProvider: profile.defaultProvider ?? undefined,
          defaultModel: profile.defaultModel ?? undefined,
          defaultProviderProfile: profile.defaultProviderProfile ?? undefined,
          audience: profile.agentResponsePreference.audience,
          explanationDepth: profile.agentResponsePreference.explanationDepth,
          jargonLevel: profile.agentResponsePreference.jargonLevel,
          codePreference: profile.agentResponsePreference.codePreference,
          clarifyBehavior: profile.agentResponsePreference.clarifyBehavior,
          formattingStyle: profile.agentResponsePreference.formattingStyle,
          extraInstructions: profile.agentResponsePreference.extraInstructions ?? ""
        });
        setPersonalAccessTokens(tokens);
        setAssistantSessions(sessions);
        if (sessions[0]) {
          void api.listAssistantEvents(sessions[0].id).then(setAssistantEvents);
        }
      })
      .catch((error) => {
        message.error(error instanceof Error ? error.message : "Failed to load profile");
      })
      .finally(() => {
        setLoading(false);
        setPersonalAccessTokenLoading(false);
      });
  }, [form, message]);

  const saveProfile = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const slackTeamId = values.slackTeamId?.trim() || null;
      const slackUserId = values.slackUserId?.trim() || null;
      const [next] = await Promise.all([api.updateProfile({
        name: values.name,
        githubUsername: values.githubUsername?.trim() || null,
        defaultProvider: values.defaultProvider ?? null,
        defaultModel: values.defaultModel?.trim() || null,
        defaultProviderProfile: values.defaultProviderProfile ?? null,
        agentResponsePreference: {
          audience: values.audience,
          explanationDepth: values.explanationDepth,
          jargonLevel: values.jargonLevel,
          codePreference: values.codePreference,
          clarifyBehavior: values.clarifyBehavior,
          formattingStyle: values.formattingStyle,
          extraInstructions: values.extraInstructions?.trim() || undefined
        }
      }), api.updateSlackIdentity({ slackTeamId, slackUserId })]);
      setSessionUser({
        name: next.name,
        githubUsername: next.githubUsername,
        defaultProvider: next.defaultProvider,
        defaultModel: next.defaultModel,
        defaultProviderProfile: next.defaultProviderProfile,
        agentResponsePreference: next.agentResponsePreference
      });
      message.success("Profile updated");
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) {
        return;
      }
      message.error(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const regenerateMcpPersonalAccessToken = async (): Promise<void> => {
    setPersonalAccessTokenLoading(true);
    setGeneratedPersonalAccessToken(null);
    try {
      await Promise.all(activeMcpTokens.map((token) => api.revokePersonalAccessToken(token.id)));
      const token = await api.createPersonalAccessToken({ name: MCP_PROFILE_TOKEN_NAME });
      setGeneratedPersonalAccessToken(token.token);
      setPersonalAccessTokens(await api.listPersonalAccessTokens());
      message.success(currentMcpToken ? "Personal access token regenerated" : "Personal access token generated");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to generate personal access token");
    } finally {
      setPersonalAccessTokenLoading(false);
    }
  };

  const copyGeneratedPersonalAccessToken = async (): Promise<void> => {
    if (!generatedPersonalAccessToken) {
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedPersonalAccessToken);
      message.success("Token copied");
    } catch {
      message.error("Failed to copy token");
    }
  };

  const clearAssistantSession = async (): Promise<void> => {
    setClearingAssistantSession(true);
    try {
      await api.clearAssistantSession();
      setAssistantSessions(await api.listAssistantSessions());
      setAssistantEvents([]);
      message.success("Slack assistant session cleared");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to clear Slack assistant session");
    } finally {
      setClearingAssistantSession(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex vertical gap={0}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Profile
        </Typography.Title>
        <Typography.Text type="secondary">
          {session?.user.name || "Administrator"}
        </Typography.Text>
      </Flex>
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: session?.user.name,
            githubUsername: session?.user.githubUsername ?? "",
            defaultProvider: session?.user.defaultProvider ?? undefined,
            defaultModel: session?.user.defaultModel ?? undefined,
            defaultProviderProfile: session?.user.defaultProviderProfile ?? undefined,
            audience: session?.user.agentResponsePreference?.audience,
            explanationDepth: session?.user.agentResponsePreference?.explanationDepth,
            jargonLevel: session?.user.agentResponsePreference?.jargonLevel,
            codePreference: session?.user.agentResponsePreference?.codePreference,
            clarifyBehavior: session?.user.agentResponsePreference?.clarifyBehavior,
            formattingStyle: session?.user.agentResponsePreference?.formattingStyle,
            extraInstructions: session?.user.agentResponsePreference?.extraInstructions ?? ""
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter your name" }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="githubUsername"
            label="GitHub Username"
            rules={[{ max: 80, message: "GitHub username must be 80 characters or fewer." }]}
          >
            <Input autoComplete="off" placeholder="octocat" />
          </Form.Item>
          <Divider orientation="left" plain>
            Slack Assistant
          </Divider>
          <Card size="small">
            <Typography.Paragraph type="secondary">
              Link the immutable IDs from your Slack profile. Both values are required. Clearing both disables DM access.
            </Typography.Paragraph>
            <Form.Item
              name="slackTeamId"
              label="Slack Workspace ID"
              dependencies={["slackUserId"]}
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    const other = form.getFieldValue("slackUserId") as string | undefined;
                    if (Boolean(value?.trim()) !== Boolean(other?.trim())) {
                      throw new Error("Workspace ID and user ID must be set together.");
                    }
                  }
                }
              ]}
            >
              <Input autoComplete="off" placeholder="T0123456789" />
            </Form.Item>
            <Form.Item
              name="slackUserId"
              label="Slack User ID"
              dependencies={["slackTeamId"]}
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    const other = form.getFieldValue("slackTeamId") as string | undefined;
                    if (Boolean(value?.trim()) !== Boolean(other?.trim())) {
                      throw new Error("Workspace ID and user ID must be set together.");
                    }
                  }
                }
              ]}
            >
              <Input autoComplete="off" placeholder="U0123456789" />
            </Form.Item>
            <Divider />
            {assistantSessions.length > 0 ? (
              <Space direction="vertical" size={4}>
                <Typography.Text>
                  Latest session: {assistantSessions[0]!.provider} · {assistantSessions[0]!.status}
                </Typography.Text>
                <Typography.Text type="secondary">
                  Updated {formatDateTime(assistantSessions[0]!.updatedAt)}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">No Slack assistant sessions.</Typography.Text>
            )}
            <div style={{ marginTop: 12 }}>
              <Button
                danger
                disabled={!assistantSessions.some((sessionItem) => sessionItem.status === "active")}
                loading={clearingAssistantSession}
                onClick={() => { void clearAssistantSession(); }}
              >
                Clear Active Session
              </Button>
            </div>
            {assistantEvents.length > 0 ? (
              <>
                <Divider orientation="left" plain>Recent Activity</Divider>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {assistantEvents.slice(-20).map((event) => (
                    <Card key={event.id} size="small">
                      <Typography.Text type="secondary">{event.kind} · {formatDateTime(event.createdAt)}</Typography.Text>
                      <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }} ellipsis={{ rows: 4, expandable: true }}>
                        {event.content}
                      </Typography.Paragraph>
                    </Card>
                  ))}
                </Space>
              </>
            ) : null}
          </Card>
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
                  const nextProvider = value ?? "codex";
                  const nextEfforts = getEffortOptionsForProvider(nextProvider);
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
          <Divider orientation="left" plain>
            Response Format Preferences
          </Divider>
          <Card size="small">
            <ResponsePolicyFields />
          </Card>
          <Divider orientation="left" plain>
            Personal Access Token
          </Divider>
          <Card size="small" loading={personalAccessTokenLoading}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text>
                Use this token for MCP clients. The token value is shown only once after generation.
              </Typography.Text>
              {currentMcpToken ? (
                <Space direction="vertical" size={4}>
                  <Space wrap>
                    <Tag color="green">Active</Tag>
                    <Typography.Text code>{currentMcpToken.tokenPrefix}...</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary">
                    Created {formatDateTime(currentMcpToken.createdAt)} \xb7 Last used {formatDateTime(currentMcpToken.lastUsedAt)}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">No active MCP personal access token.</Typography.Text>
              )}
              {generatedPersonalAccessToken ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Copy your new token now"
                  description={
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <Typography.Text>
                        This token will not be shown again. Store it in your MCP client now.
                      </Typography.Text>
                      <Input.TextArea value={generatedPersonalAccessToken} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
                      <Button icon={<CopyOutlined />} onClick={() => { void copyGeneratedPersonalAccessToken(); }}>
                        Copy token
                      </Button>
                    </Space>
                  }
                />
              ) : null}
              <Button
                type={currentMcpToken ? "default" : "primary"}
                danger={Boolean(currentMcpToken)}
                loading={personalAccessTokenLoading}
                onClick={() => { void regenerateMcpPersonalAccessToken(); }}
              >
                {currentMcpToken ? "Regenerate Token" : "Generate Token"}
              </Button>
            </Space>
          </Card>
        </Form>
      </Spin>
      <Card
        size="small"
        style={{ position: "sticky", bottom: 16, zIndex: 20 }}
        styles={{ body: { padding: 12 } }}
      >
        <Flex justify="flex-end">
          <Button type="primary" loading={saving} onClick={() => { void saveProfile(); }}>
            Save Profile
          </Button>
        </Flex>
      </Card>
    </Space>
  );
}
