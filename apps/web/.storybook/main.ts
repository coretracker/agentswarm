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
      exclude: [
        ...(config.optimizeDeps?.exclude ?? []),
        "next/link",
        "next/link.js",
        "next/navigation",
        "next/navigation.js",
        "socket.io-client"
      ],
      esbuildOptions: {
        ...config.optimizeDeps?.esbuildOptions,
        jsx: "automatic",
        jsxImportSource: "react"
      }
    },
    resolve: {
      ...config.resolve,
      alias: [
        ...(Array.isArray(config.resolve?.alias)
          ? config.resolve.alias
          : Object.entries(config.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement }))),
        { find: /^next\/link(?:\.js)?$/, replacement: resolve(__dirname, "./mock-link.tsx") },
        { find: /^next\/navigation(?:\.js)?$/, replacement: resolve(__dirname, "./mock-navigation.ts") },
        { find: /^socket\.io-client$/, replacement: resolve(__dirname, "./mock-socket.ts") },
        { find: /^@verft\/shared-types$/, replacement: resolve(__dirname, "../../../packages/shared-types/src/index.ts") }
      ]
    }
  })
};

export default config;
