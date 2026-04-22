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
          mode === "cyber"
            ? "radial-gradient(circle at top, rgba(0, 240, 255, 0.16) 0%, rgba(0, 240, 255, 0) 28%), linear-gradient(180deg, #050814 0%, #0a0a1a 56%, #101733 100%)"
            : mode === "nord"
              ? "radial-gradient(circle at top, rgba(136, 192, 208, 0.14) 0%, rgba(136, 192, 208, 0) 30%), linear-gradient(180deg, #242933 0%, #2b303b 56%, #313846 100%)"
              : mode === "solarized-light"
                ? "radial-gradient(circle at top, rgba(38, 139, 210, 0.08) 0%, rgba(38, 139, 210, 0) 28%), linear-gradient(180deg, #fdf6e3 0%, #f4edd8 58%, #ece3cb 100%)"
                : mode === "gruvbox-dark"
                  ? "radial-gradient(circle at top, rgba(215, 153, 33, 0.16) 0%, rgba(215, 153, 33, 0) 30%), linear-gradient(180deg, #1d2021 0%, #282828 56%, #32302f 100%)"
                  : mode === "high-contrast"
                    ? "radial-gradient(circle at top, rgba(77, 163, 255, 0.18) 0%, rgba(77, 163, 255, 0) 30%), linear-gradient(180deg, #000000 0%, #050505 56%, #0f0f0f 100%)"
                    : mode === "tokyo-night"
                      ? "radial-gradient(circle at top, rgba(122, 162, 247, 0.16) 0%, rgba(122, 162, 247, 0) 30%), linear-gradient(180deg, #141521 0%, #16161e 54%, #1f2335 100%)"
                      : mode === "solarized-dark"
                        ? "radial-gradient(circle at top, rgba(38, 139, 210, 0.14) 0%, rgba(38, 139, 210, 0) 30%), linear-gradient(180deg, #001820 0%, #001f27 54%, #073642 100%)"
                        : mode === "paper"
                          ? "radial-gradient(circle at top, rgba(70, 124, 138, 0.08) 0%, rgba(70, 124, 138, 0) 28%), linear-gradient(180deg, #fffaf0 0%, #f7f1e3 56%, #efe8d5 100%)"
                          : mode === "forge"
                            ? "radial-gradient(circle at top, rgba(255, 107, 53, 0.16) 0%, rgba(255, 107, 53, 0) 28%), linear-gradient(180deg, #0b0f14 0%, #0d1117 56%, #141b25 100%)"
                            : mode === "github"
                              ? "radial-gradient(circle at top, rgba(31, 111, 235, 0.14) 0%, rgba(31, 111, 235, 0) 28%), linear-gradient(180deg, #0b0f14 0%, #0d1117 56%, #161b22 100%)"
                              : mode === "github-light"
                                ? "radial-gradient(circle at top, rgba(9, 105, 218, 0.1) 0%, rgba(9, 105, 218, 0) 30%), linear-gradient(180deg, #ffffff 0%, #f6f8fa 56%, #eef2f6 100%)"
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
              mode === "cyber"
                ? "none"
                : mode === "nord"
                  ? "0 24px 60px rgba(36, 41, 51, 0.38)"
                  : mode === "solarized-light"
                    ? "0 24px 60px rgba(131, 148, 150, 0.18)"
                    : mode === "gruvbox-dark"
                      ? "0 24px 60px rgba(0, 0, 0, 0.42)"
                      : mode === "high-contrast"
                        ? "0 0 0 1px rgba(255, 255, 255, 0.28)"
                        : mode === "tokyo-night"
                          ? "0 24px 60px rgba(8, 10, 18, 0.44)"
                          : mode === "solarized-dark"
                            ? "0 24px 60px rgba(0, 10, 14, 0.42)"
                            : mode === "paper"
                              ? "0 24px 60px rgba(139, 135, 125, 0.16)"
                              : mode === "forge"
                                ? "0 24px 60px rgba(0, 0, 0, 0.5)"
                                : mode === "github"
                                  ? "0 24px 60px rgba(1, 4, 9, 0.48)"
                                  : mode === "github-light"
                                    ? "0 24px 60px rgba(140, 149, 159, 0.2)"
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
