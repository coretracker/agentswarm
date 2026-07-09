"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button, Drawer, Flex, Input, Typography } from "antd";
import { isDarkAppTheme } from "../src/theme/antd-theme";
import { HARNESS_EDITOR_OPTIONS, normalizeHarnessMarkdown } from "../src/utils/harness-editor";
import { useThemeMode } from "./theme-provider";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false }
);

export interface HarnessMarkdownFieldProps {
  value?: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
  label: string;
}

export function HarnessMarkdownField({
  value,
  onChange,
  disabled = false,
  label
}: HarnessMarkdownFieldProps) {
  const { mode } = useThemeMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const markdown = normalizeHarnessMarkdown(value);

  const openEditor = (): void => {
    setDraft(markdown);
    setDrawerOpen(true);
  };

  const closeEditor = (): void => {
    setDrawerOpen(false);
  };

  const applyEdit = (): void => {
    onChange?.(draft);
    setDrawerOpen(false);
  };

  return (
    <>
      <Flex vertical align="start" gap={2}>
        <Input.TextArea
          value={markdown}
          readOnly
          autoSize={{ minRows: 3 }}
          aria-label={`${label} content`}
        />
        <Button type="link" size="small" disabled={disabled} onClick={openEditor} style={{ paddingInline: 0 }}>
          Edit
        </Button>
      </Flex>
      <Drawer
        title={`Edit ${label}`}
        placement="right"
        width="min(720px, 92vw)"
        open={drawerOpen}
        onClose={closeEditor}
        destroyOnClose
        extra={
          <Flex gap={8}>
            <Button onClick={closeEditor}>Cancel</Button>
            <Button type="primary" onClick={applyEdit}>
              Apply
            </Button>
          </Flex>
        }
      >
        <Flex vertical gap={8} style={{ height: "100%" }}>
          <Typography.Text type="secondary">Markdown</Typography.Text>
          <div style={{ flex: 1, minHeight: 320 }}>
            <MonacoEditor
              height="100%"
              theme={isDarkAppTheme(mode) ? "vs-dark" : "vs"}
              language="markdown"
              value={draft}
              onChange={(nextValue) => setDraft(nextValue ?? "")}
              options={HARNESS_EDITOR_OPTIONS}
            />
          </div>
        </Flex>
      </Drawer>
    </>
  );
}
