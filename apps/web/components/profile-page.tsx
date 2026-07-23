"use client";

import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Divider, Flex, Form, Input, Space, Spin, Tag, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";
import type { PersonalAccessToken } from "@verft/shared-types";
import { UserProfileFields, type UserProfileFormValues } from "./user-profile-fields";

const MCP_PROFILE_TOKEN_NAME = "Verft MCP";

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
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [form] = Form.useForm<UserProfileFormValues>();

  const activeMcpTokens = personalAccessTokens.filter((token) => token.name === MCP_PROFILE_TOKEN_NAME && !token.revokedAt);
  const currentMcpToken = activeMcpTokens[0] ?? null;

  useEffect(() => {
    void Promise.all([api.getProfile(), api.listPersonalAccessTokens()])
      .then(([profile, tokens]) => {
        form.setFieldsValue({
          name: profile.name,
          githubUsername: profile.githubUsername ?? "",
          defaultProvider: profile.defaultProvider ?? undefined,
          defaultModel: profile.defaultModel ?? undefined,
          defaultProviderProfile: profile.defaultProviderProfile ?? undefined
        });
        setEmail(profile.email);
        setPersonalAccessTokens(tokens);
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
      const next = await api.updateProfile({
        name: values.name,
        githubUsername: values.githubUsername?.trim() || null,
        defaultProvider: values.defaultProvider ?? null,
        defaultModel: values.defaultModel?.trim() || null,
        defaultProviderProfile: values.defaultProviderProfile ?? null
      });
      setSessionUser({
        name: next.name,
        githubUsername: next.githubUsername,
        defaultProvider: next.defaultProvider,
        defaultModel: next.defaultModel,
        defaultProviderProfile: next.defaultProviderProfile
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
            defaultProviderProfile: session?.user.defaultProviderProfile ?? undefined
          }}
        >
          <Form.Item label="Email">
            <Input value={email} readOnly />
          </Form.Item>
          <UserProfileFields form={form} />
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
