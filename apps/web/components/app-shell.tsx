"use client";

import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Drawer, Flex, Grid, Layout, Menu, Result, Spin, Switch, Typography, theme as antTheme } from "antd";
import {
  DatabaseOutlined,
  BulbOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
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
import {
  getRequiredScopesForPathname,
  getSelectedNavigationKey,
  isPublicPathname,
  isTerminalFullscreenPath,
  navigationRoutes,
  resolveDefaultPath
} from "../src/auth/access";

const menuIconByPath: Record<string, ReactNode> = {
  "/tasks": <UnorderedListOutlined />,
  "/repositories": <DatabaseOutlined />,
  "/settings": <SettingOutlined />,
  "/users": <TeamOutlined />
};
const SIDEBAR_COLLAPSED_STORAGE_KEY = "verft.sidebarCollapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAll, loading, logout, session } = useAuth();
  const { isDarkTheme, setMode } = useThemeMode();
  const contentMaxWidth = 1760;
  const headerHeight = 64;
  const sidebarWidth = 320;
  const { token } = antTheme.useToken();
  const screens = Grid.useBreakpoint();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures; the in-memory preference still applies for this session.
      }
      return next;
    });
  };

  if (publicPath) {
    return <App>{children}</App>;
  }

  if (loading || !session) {
    return <Spin fullscreen tip="Loading session" />;
  }

  if (isTerminalFullscreenPath(pathname)) {
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
              <AppLogo width={100} height={26} />
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
              <TaskBrowserNotifications />
              <Flex vertical gap={0} style={{ minWidth: 0 }}>
                <Button type="text" style={{ paddingInline: 6 }} onClick={() => router.push("/profile")}>
                  <Typography.Text strong>{`Hi, ${session.user.name || "Administrator"}`}</Typography.Text>
                </Button>
              </Flex>
              <Switch
                checked={isDarkTheme}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<BulbOutlined />}
                aria-label="Toggle dark mode"
                onChange={(checked) => setMode(checked ? "graphite-dark" : "graphite-light")}
              />
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
        <Layout style={{ flex: 1, minHeight: 0, background: token.colorBgLayout, position: "relative" }}>
          {desktopSidebar ? (
            <Layout.Sider
              width={sidebarWidth}
              trigger={null}
              theme="light"
              style={{
                position: "fixed",
                left: 0,
                top: headerHeight,
                zIndex: 15,
                height: `calc(100vh - ${headerHeight}px)`,
                background: token.colorBgContainer,
                borderRight: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: sidebarCollapsed ? "none" : token.boxShadowSecondary,
                overflow: "hidden",
                transform: sidebarCollapsed ? "translateX(-100%)" : "translateX(0)",
                transition: "transform 220ms ease, box-shadow 220ms ease",
                pointerEvents: sidebarCollapsed ? "none" : "auto"
              }}
            >
              <div
                style={{
                  width: sidebarWidth,
                  height: "100%",
                  boxSizing: "border-box",
                  opacity: sidebarCollapsed ? 0 : 1,
                  transition: "opacity 140ms ease"
                }}
              >
                <AppSidebar
                  pathname={pathname}
                  onNavigate={(path) => router.push(path)}
                  headerExtra={
                    <Button
                      type="text"
                      icon={<MenuFoldOutlined />}
                      aria-label="Hide sidebar"
                      title="Hide sidebar"
                      onClick={toggleSidebarCollapsed}
                    />
                  }
                />
              </div>
            </Layout.Sider>
          ) : null}
          {desktopSidebar ? (
            <Button
              type="primary"
              icon={<MenuUnfoldOutlined />}
              aria-label="Show sidebar"
              title="Show sidebar"
              onClick={toggleSidebarCollapsed}
              style={{
                position: "fixed",
                top: headerHeight + 16,
                left: 0,
                zIndex: 16,
                width: 40,
                height: 40,
                borderRadius: "0 6px 6px 0",
                boxShadow: token.boxShadowSecondary,
                opacity: sidebarCollapsed ? 1 : 0,
                transform: sidebarCollapsed ? "translateX(0)" : "translateX(-100%)",
                pointerEvents: sidebarCollapsed ? "auto" : "none",
                transition: "opacity 160ms ease, transform 220ms ease"
              }}
            />
          ) : null}
          <Layout
            style={{
              minWidth: 0,
              marginLeft: desktopSidebar && !sidebarCollapsed ? sidebarWidth : 0,
              background: token.colorBgLayout,
              transition: "margin-left 220ms ease"
            }}
          >
            <Layout.Content
              style={{
                paddingBlock: 24,
                paddingInline: desktopSidebar ? 50 : 24,
                minHeight: 0,
                overflow: "auto",
                background: token.colorBgLayout
              }}
            >
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
