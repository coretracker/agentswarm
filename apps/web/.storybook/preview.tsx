import type { Preview } from "@storybook/react";
import React from "react";
import { ThemeProvider } from "../components/theme-provider";
import "../app/globals.css";
import "react-diff-view/style/index.css";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider>
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
      </ThemeProvider>
    )
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
