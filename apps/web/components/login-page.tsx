"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Flex, Form, Input, Typography } from "antd";
import type { LoginInput } from "@agentswarm/shared-types";
import { ApiError } from "../src/api/client";
import { resolveDefaultPath } from "../src/auth/access";
import { AppFooterNote } from "./app-footer-note";
import { AppLogo } from "./app-logo";
import { useAuth } from "./auth-provider";
import { useThemeMode } from "./theme-provider";

export function LoginPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { loading, login, session } = useAuth();
  const { mode } = useThemeMode();
  const [form] = Form.useForm<LoginInput>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session) {
      return;
    }

    router.replace(resolveDefaultPath(session.user.scopes) ?? "/");
  }, [loading, router, session]);

  return (
    <Flex
      vertical
      justify="space-between"
      style={{
        minHeight: "100vh",
        padding: 24,
        background:
          mode === "dark"
            ? "linear-gradient(180deg, #0f1613 0%, #19231e 100%)"
            : "linear-gradient(180deg, #f6f7fb 0%, #e8edf5 100%)"
      }}
    >
      <Flex
        flex={1}
        align="center"
        justify="center"
        style={{
          minHeight: 0
        }}
      >
        <Card
          bordered={false}
          style={{
            width: "100%",
            maxWidth: 440,
            boxShadow: mode === "dark" ? "0 24px 60px rgba(0, 0, 0, 0.38)" : "0 24px 60px rgba(15, 23, 42, 0.12)"
          }}
        >
          <Flex vertical gap={8} style={{ marginBottom: 24 }}>
            <Flex align="center" gap={12} style={{ marginBottom: 8 }}>
              <AppLogo width={22} height={32} />
              <Typography.Title level={3} style={{ margin: 0 }}>
                AgentSwarm
              </Typography.Title>
            </Flex>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Sign in
            </Typography.Title>
            <Typography.Text type="secondary">
              Use the seeded admin account on first boot, then rotate the password and create real users and roles.
            </Typography.Text>
          </Flex>

          {errorMessage ? (
            <Alert
              type="error"
              showIcon
              message={errorMessage}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Form
            form={form}
            layout="vertical"
            onFinish={async (values) => {
              setSubmitting(true);
              setErrorMessage(null);
              try {
                const nextSession = await login(values);
                message.success(`Signed in as ${nextSession.user.email}`);
                router.replace(resolveDefaultPath(nextSession.user.scopes) ?? "/");
              } catch (error) {
                setErrorMessage(error instanceof ApiError ? error.message : "Failed to sign in");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              name="email"
              label="Email"
              rules={[{ required: true, message: "Enter your email address" }]}
            >
              <Input autoComplete="username" placeholder="admin@localhost" size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: "Enter your password" }]}
            >
              <Input.Password autoComplete="current-password" placeholder="Password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting || loading} block size="large">
              Sign in
            </Button>
          </Form>
        </Card>
      </Flex>
      <div style={{ paddingTop: 16 }}>
        <AppFooterNote />
      </div>
    </Flex>
  );
}
