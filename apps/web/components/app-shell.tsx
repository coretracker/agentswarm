"use client";

import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Drawer, Flex, Grid, Layout, Menu, Result, Select, Spin, Typography, theme as antTheme } from "antd";
import {
  BgColorsOutlined,
  CopyOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { AppLogo } from "./app-logo";
import { AppSidebar } from "./app-sidebar";
import { AppFooterNote } from "./app-footer-note";
import { useAuth } from "./auth-provider";
import { TaskBrowserNotifications } from "./task-browser-notifications";
import { useThemeMode } from "./theme-provider";
import { appThemeOptions, type AppThemeMode } from "../src/theme/antd-theme";
import {
  getRequiredScopesForPathname,
  getSelectedNavigationKey,
  isPublicPathname,
  isTaskInteractiveFullscreenPath,
  navigationRoutes,
  resolveDefaultPath
} from "../src/auth/access";

const menuIconByPath: Record<string, ReactNode> = {
  "/tasks": <UnorderedListOutlined />,
  "/snippets": <CopyOutlined />,
  "/repositories": <DatabaseOutlined />,
  "/settings": <SettingOutlined />,
  "/users": <TeamOutlined />
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAll, loading, logout, session } = useAuth();
  const { mode, setMode } = useThemeMode();
  const contentMaxWidth = 1760;
  const headerHeight = 64;
  const sidebarWidth = 320;
  const { token } = antTheme.useToken();
  const screens = Grid.useBreakpoint();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const publicPath = isPublicPathname(pathname);
  const desktopSidebar = screens.lg ?? false;
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

  useEffect(() => {
    if (desktopSidebar) {
      setMobileSidebarOpen(false);
    }
  }, [desktopSidebar]);

  if (publicPath) {
    return <App>{children}</App>;
  }

  if (loading || !session) {
    return <Spin fullscreen tip="Loading session" />;
  }

  if (isTaskInteractiveFullscreenPath(pathname)) {
    return (
      <App>
        {hasRouteAccess ? (
          <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>{children}</div>
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
      </App>
    );
  }

  const shellContent = (
    <>
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
            style={{ height: "100%", width: "100%", gap: 24 }}
          >
            <Flex align="center" gap={12}>
              {!desktopSidebar ? (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  aria-label="Open navigation"
                  onClick={() => setMobileSidebarOpen(true)}
                />
              ) : null}
              <AppLogo width={28} height={40} />
              <Flex vertical gap={0}>
                <Typography.Title level={4} style={{ margin: 0, color: token.colorText }}>
                  AgentSwarm
                </Typography.Title>
              </Flex>
            </Flex>
            <Menu
              mode="horizontal"
              selectedKeys={[selectedNavigationKey]}
              items={menuItems}
              onClick={({ key }) => router.push(key)}
              selectable
              style={{ minWidth: 0, borderBottom: 0, flex: 1, background: "transparent" }}
            />
            <Flex align="center" gap={12}>
              <Select
                size="small"
                value={mode}
                onChange={(value) => setMode(value as AppThemeMode)}
                options={appThemeOptions}
                variant="borderless"
                suffixIcon={<BgColorsOutlined />}
                style={{ minWidth: 132 }}
              />
              <TaskBrowserNotifications />
              <Flex vertical gap={0} style={{ minWidth: 0 }}>
                <Typography.Text strong>{`Hi, ${session.user.name || "Administrator"}`}</Typography.Text>
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
        <Layout style={{ flex: 1, minHeight: 0, background: token.colorBgLayout }}>
          {desktopSidebar ? (
            <Layout.Sider
              width={sidebarWidth}
              theme="light"
              style={{
                position: "sticky",
                top: headerHeight,
                alignSelf: "flex-start",
                height: `calc(100vh - ${headerHeight}px)`,
                background: token.colorBgContainer,
                borderRight: `1px solid ${token.colorBorderSecondary}`,
                overflow: "hidden"
              }}
            >
              <AppSidebar pathname={pathname} onNavigate={(path) => router.push(path)} />
            </Layout.Sider>
          ) : null}
          <Layout style={{ minWidth: 0, background: token.colorBgLayout }}>
            <Layout.Content style={{ padding: 24, minHeight: 0, overflow: "auto", background: token.colorBgLayout }}>
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
            <Layout.Footer
              style={{
                padding: "8px 24px 18px",
                background: token.colorBgLayout
              }}
            >
              <div style={{ width: "100%", maxWidth: contentMaxWidth, marginInline: "auto" }}>
                <AppFooterNote />
              </div>
            </Layout.Footer>
          </Layout>
        </Layout>
      </Layout>
      <Drawer
        placement="left"
        open={!desktopSidebar && mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        width={sidebarWidth}
        styles={{ body: { padding: 0 } }}
      >
        <AppSidebar
          pathname={pathname}
          onNavigate={(path) => {
            setMobileSidebarOpen(false);
            router.push(path);
          }}
        />
      </Drawer>
    </>
  );

  return <App>{shellContent}</App>;
}
