import { resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {}
  },
  docs: {
    autodocs: "tag"
  },
  viteFinal: (config) => ({
    ...config,
    esbuild: {
      ...config.esbuild,
      jsx: "automatic",
      jsxImportSource: "react"
    },
    optimizeDeps: {
      ...config.optimizeDeps,
      esbuildOptions: {
        ...config.optimizeDeps?.esbuildOptions,
        jsx: "automatic",
        jsxImportSource: "react"
      }
    },
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        "@verft/shared-types": resolve(__dirname, "../../../packages/shared-types/src/index.ts")
      }
    }
  })
};

export default config;
