"use client";

import { App, Flex, Layout, Menu, Typography, theme as antTheme } from "antd";
import { DatabaseOutlined, SettingOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";

const menuItems = [
  { key: "/tasks", icon: <UnorderedListOutlined />, label: "Tasks" },
  { key: "/repositories", icon: <DatabaseOutlined />, label: "Repositories" },
  { key: "/settings", icon: <SettingOutlined />, label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const contentMaxWidth = 1760;
  const { token } = antTheme.useToken();

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
              selectedKeys={[pathname.startsWith("/tasks/") ? "/tasks" : pathname]}
              items={menuItems}
              onClick={({ key }) => router.push(key)}
              selectable
              style={{ minWidth: 360, justifyContent: "flex-end", borderBottom: 0, flex: 1, background: "transparent" }}
            />
          </Flex>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, minHeight: 0, background: token.colorBgLayout }}>
          <div style={{ width: "100%", maxWidth: contentMaxWidth, marginInline: "auto", minHeight: "100%" }}>{children}</div>
        </Layout.Content>
      </Layout>
    </App>
  );
}
