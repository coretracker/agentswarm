"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Flex, Form, Input, Typography } from "antd";
import type { LoginInput } from "@agentswarm/shared-types";
import { ApiError } from "../src/api/client";
import { resolveDefaultPath } from "../src/auth/access";
import { isDarkAppTheme } from "../src/theme/antd-theme";
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
          mode === "forge"
            ? "radial-gradient(circle at top, rgba(255, 107, 53, 0.16) 0%, rgba(255, 107, 53, 0) 28%), linear-gradient(180deg, #0b0f14 0%, #0d1117 56%, #141b25 100%)"
            : mode === "forge-light"
              ? "radial-gradient(circle at top, rgba(255, 107, 53, 0.12) 0%, rgba(255, 107, 53, 0) 30%), linear-gradient(180deg, #fffaf6 0%, #fff3eb 56%, #f7e7dc 100%)"
              : mode === "github"
                ? "radial-gradient(circle at top, rgba(31, 111, 235, 0.14) 0%, rgba(31, 111, 235, 0) 28%), linear-gradient(180deg, #0b0f14 0%, #0d1117 56%, #161b22 100%)"
                : mode === "github-light"
                  ? "radial-gradient(circle at top, rgba(9, 105, 218, 0.1) 0%, rgba(9, 105, 218, 0) 30%), linear-gradient(180deg, #ffffff 0%, #f6f8fa 56%, #eef2f6 100%)"
                  : mode === "verft-light"
                    ? "radial-gradient(circle at top, rgba(26, 122, 155, 0.10) 0%, rgba(26, 122, 155, 0) 30%), linear-gradient(180deg, #F5F2E8 0%, #EEF6F8 56%, #E2EFF8 100%)"
                    : mode === "verft-dark"
                      ? "radial-gradient(circle at top, rgba(212, 168, 75, 0.12) 0%, rgba(212, 168, 75, 0) 28%), linear-gradient(180deg, #080F18 0%, #0C1822 56%, #101E30 100%)"
                      : mode === "ember-light"
                        ? "radial-gradient(circle at top, rgba(210, 83, 31, 0.12) 0%, rgba(210, 83, 31, 0) 30%), linear-gradient(180deg, #fbf7f4 0%, #f5ebe4 56%, #ecd8cc 100%)"
                        : mode === "ember-dark"
                          ? "radial-gradient(circle at top, rgba(242, 107, 54, 0.14) 0%, rgba(242, 107, 54, 0) 28%), linear-gradient(180deg, #110a06 0%, #1a120e 56%, #241811 100%)"
                          : mode === "moss-light"
                            ? "radial-gradient(circle at top, rgba(62, 124, 65, 0.10) 0%, rgba(62, 124, 65, 0) 30%), linear-gradient(180deg, #f6f8f4 0%, #eaf0e4 56%, #d8e8d0 100%)"
                            : mode === "moss-dark"
                              ? "radial-gradient(circle at top, rgba(93, 163, 95, 0.12) 0%, rgba(93, 163, 95, 0) 28%), linear-gradient(180deg, #0a1009 0%, #0f1710 56%, #17231a 100%)"
                              : mode === "graphite-light"
                                ? "radial-gradient(circle at top, rgba(47, 111, 235, 0.10) 0%, rgba(47, 111, 235, 0) 30%), linear-gradient(180deg, #f7f8f9 0%, #eef0f2 56%, #e2e6ea 100%)"
                                : mode === "graphite-dark"
                                  ? "radial-gradient(circle at top, rgba(77, 141, 255, 0.12) 0%, rgba(77, 141, 255, 0) 28%), linear-gradient(180deg, #090b0e 0%, #0e1013 56%, #171a1f 100%)"
                                  : isDarkAppTheme(mode)
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
            boxShadow:
              mode === "forge"
                ? "0 24px 60px rgba(0, 0, 0, 0.5)"
                : mode === "forge-light"
                  ? "0 24px 60px rgba(120, 73, 45, 0.18)"
                  : mode === "github"
                    ? "0 24px 60px rgba(1, 4, 9, 0.48)"
                    : mode === "github-light"
                      ? "0 24px 60px rgba(140, 149, 159, 0.2)"
                      : mode === "verft-light"
                        ? "0 24px 60px rgba(26, 122, 155, 0.14)"
                        : mode === "verft-dark"
                          ? "0 24px 60px rgba(0, 0, 0, 0.45)"
                          : mode === "ember-light"
                            ? "0 24px 60px rgba(43, 26, 18, 0.16)"
                            : mode === "ember-dark"
                              ? "0 24px 60px rgba(0, 0, 0, 0.50)"
                              : mode === "moss-light"
                                ? "0 24px 60px rgba(27, 42, 23, 0.14)"
                                : mode === "moss-dark"
                                  ? "0 24px 60px rgba(0, 0, 0, 0.45)"
                                  : mode === "graphite-light"
                                    ? "0 24px 60px rgba(26, 29, 33, 0.14)"
                                    : mode === "graphite-dark"
                                      ? "0 24px 60px rgba(0, 0, 0, 0.48)"
                                      : isDarkAppTheme(mode)
                                        ? "0 24px 60px rgba(0, 0, 0, 0.38)"
                                        : "0 24px 60px rgba(15, 23, 42, 0.12)"
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
            data-testid="login-form"
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
              <Input
                autoComplete="username"
                placeholder="admin@localhost"
                size="large"
                data-testid="login-email-input"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: "Enter your password" }]}
            >
              <Input.Password
                autoComplete="current-password"
                placeholder="Password"
                size="large"
                data-testid="login-password-input"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting || loading}
              block
              size="large"
              data-testid="login-submit-button"
            >
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
