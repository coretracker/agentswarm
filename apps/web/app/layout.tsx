import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppShell } from "../components/app-shell";
import { AuthProvider } from "../components/auth-provider";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";
import "react-diff-view/style/index.css";

export const metadata: Metadata = {
  title: "AgentSwarm",
  description: "Build, ask, and manage autonomous coding tasks"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ThemeProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
