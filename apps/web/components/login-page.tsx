"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Flex, Form, Input, Typography } from "antd";
import type { LoginInput } from "@verft/shared-types";
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
  const { isDarkTheme } = useThemeMode();
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
        background: isDarkTheme
          ? "radial-gradient(circle at top, rgba(77, 141, 255, 0.12) 0%, rgba(77, 141, 255, 0) 28%), linear-gradient(180deg, #090b0e 0%, #0e1013 56%, #171a1f 100%)"
          : "radial-gradient(circle at top, rgba(47, 111, 235, 0.10) 0%, rgba(47, 111, 235, 0) 30%), linear-gradient(180deg, #f7f8f9 0%, #eef0f2 56%, #e2e6ea 100%)"
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
            boxShadow: isDarkTheme ? "0 24px 60px rgba(0, 0, 0, 0.48)" : "0 24px 60px rgba(26, 29, 33, 0.14)"
          }}
        >
          <Flex vertical gap={8} style={{ marginBottom: 24 }}>
            <Flex align="center" justify="center" gap={12} style={{ marginBottom: 8 }}>
              <AppLogo width={100} height={26} />
            </Flex>
            <Typography.Text type="secondary">
              Enter your email and password to access your Verft workspace.
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
