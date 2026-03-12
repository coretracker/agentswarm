import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import { AppShell } from "../components/app-shell";
import { appAntdTheme } from "../src/theme/antd-theme";
import "./globals.css";
import "react-diff-view/style/index.css";

export const metadata: Metadata = {
  title: "AgentSwarm",
  description: "Plan, build, and iterate autonomous coding tasks"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ConfigProvider theme={appAntdTheme}>
            <AppShell>{children}</AppShell>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
