import type { Preview } from "@storybook/react";
import React from "react";
import { App } from "antd";
import { ThemeProvider } from "../components/theme-provider";
import { AuthProvider } from "../components/auth-provider";
import { adminSession } from "./fixtures";
import { installMockApi, type MockApiOverrides } from "./mock-api";
import { setMockNavigationState } from "./mock-navigation";
import "./browser-shims";
import "../app/globals.css";
import "react-diff-view/style/index.css";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

interface VerftStoryParameters {
  pathname?: string;
  search?: string | URLSearchParams | Record<string, string>;
  params?: Record<string, string | string[]>;
  session?: typeof adminSession | null;
  api?: MockApiOverrides;
  shell?: "padded" | "fullscreen";
}

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const verft = (context.parameters.verft ?? {}) as VerftStoryParameters;
      installMockApi(verft.api);
      setMockNavigationState({
        pathname: verft.pathname ?? "/tasks",
        search: verft.search ? new URLSearchParams(verft.search).toString() : "",
        params: verft.params ?? {}
      });

      const story = (
        <ThemeProvider>
          <AuthProvider initialSession={verft.session === undefined ? adminSession : verft.session} autoLoadSession={false}>
            <App>
              <Story />
            </App>
          </AuthProvider>
        </ThemeProvider>
      );

      if (verft.shell === "fullscreen") {
        return story;
      }

      return (
        <ThemeProvider>
          <AuthProvider initialSession={verft.session === undefined ? adminSession : verft.session} autoLoadSession={false}>
            <App>
              <div
                style={{
                  minHeight: "100vh",
                  padding: 24,
                  background: "var(--app-body-bg)",
                  color: "var(--app-body-text)"
                }}
              >
                <Story />
              </div>
            </App>
          </AuthProvider>
        </ThemeProvider>
      );
    }
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    backgrounds: {
      default: "Verft dark",
      values: [
        { name: "Verft dark", value: "#0a0d10" },
        { name: "Verft light", value: "#eef0f2" }
      ]
    }
  }
};

export default preview;
