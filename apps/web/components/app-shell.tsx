"use client";

import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Flex, Layout, Menu, Result, Spin, Typography, theme as antTheme } from "antd";
import { DatabaseOutlined, LogoutOutlined, SettingOutlined, TeamOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import {
  getRequiredScopesForPathname,
  getSelectedNavigationKey,
  isPublicPathname,
  navigationRoutes,
  resolveDefaultPath
} from "../src/auth/access";

const menuIconByPath: Record<string, ReactNode> = {
  "/tasks": <UnorderedListOutlined />,
  "/repositories": <DatabaseOutlined />,
  "/settings": <SettingOutlined />,
  "/users": <TeamOutlined />
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAll, loading, logout, session } = useAuth();
  const contentMaxWidth = 1760;
  const { token } = antTheme.useToken();
  const [loggingOut, setLoggingOut] = useState(false);
  const publicPath = isPublicPathname(pathname);
  const selectedNavigationKey = getSelectedNavigationKey(pathname);
  const defaultPath = session ? resolveDefaultPath(session.user.scopes) : null;
  const menuItems = navigationRoutes
    .filter((route) => canAll(route.requiredScopes))
    .map((route) => ({
      key: route.key,
      icon: menuIconByPath[route.key],
      label: route.label
    }));
  const hasRouteAccess = session ? canAll(getRequiredScopesForPathname(pathname)) : false;

  useEffect(() => {
    if (loading || publicPath) {
      return;
    }

    if (!session) {
      router.replace("/login");
    }
  }, [loading, publicPath, router, session]);

  if (publicPath) {
    return <App>{children}</App>;
  }

  if (loading || !session) {
    return <Spin fullscreen tip="Loading session" />;
  }

  return (
    <App>
      <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
        <Layout.Header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            paddingInline: 24,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            boxShadow: token.boxShadowSecondary
          }}
        >
          <Flex
            align="center"
            justify="space-between"
            style={{ height: "100%", width: "100%", maxWidth: contentMaxWidth, marginInline: "auto", gap: 24 }}
          >
            <Flex align="center" gap={12}>
              <img
                src="/logo.svg"
                alt="AgentSwarm logo"
                style={{ width: 28, height: 40, display: "block" }}
              />
              <Flex vertical gap={0}>
                <Typography.Title level={4} style={{ margin: 0, color: token.colorText }}>
                  AgentSwarm
                </Typography.Title>
                <Typography.Text style={{ color: token.colorTextSecondary }}>
                  Container-first orchestration for coding tasks
                </Typography.Text>
              </Flex>
            </Flex>
            <Menu
              mode="horizontal"
              selectedKeys={[selectedNavigationKey]}
              items={menuItems}
              onClick={({ key }) => router.push(key)}
              selectable
              style={{ minWidth: 360, justifyContent: "flex-end", borderBottom: 0, flex: 1, background: "transparent" }}
            />
            <Flex align="center" gap={12}>
              <Flex vertical gap={0} style={{ minWidth: 0 }}>
                <Typography.Text strong>{session.user.name}</Typography.Text>
              </Flex>
              <Button
                icon={<LogoutOutlined />}
                loading={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  try {
                    await logout();
                    router.replace("/login");
                  } finally {
                    setLoggingOut(false);
                  }
                }}
              >
                Logout
              </Button>
            </Flex>
          </Flex>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, minHeight: 0, background: token.colorBgLayout }}>
          <div style={{ width: "100%", maxWidth: contentMaxWidth, marginInline: "auto", minHeight: "100%" }}>
            {hasRouteAccess ? (
              children
            ) : (
              <Result
                status="403"
                title="403"
                subTitle="This account does not have access to the requested page."
                extra={
                  defaultPath ? (
                    <Button type="primary" onClick={() => router.push(defaultPath)}>
                      Go To An Allowed Page
                    </Button>
                  ) : null
                }
              />
            )}
          </div>
        </Layout.Content>
      </Layout>
    </App>
  );
}
