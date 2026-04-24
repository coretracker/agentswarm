"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Flex, Modal, Select, Space, Spin, Tag, Typography, message } from "antd";
import type { TaskWorkspaceFilePreview } from "@agentswarm/shared-types";
import { api } from "../src/api/client";
import { isDarkAppTheme } from "../src/theme/antd-theme";
import { useThemeMode } from "./theme-provider";
import { detectCodeLanguage, getCodeLanguageLabel } from "./workspace-file-preview-modal";

type NewlineStyle = "lf" | "crlf";

interface EditableFileState {
  loading: boolean;
  loaded: boolean;
  saving: boolean;
  preview: TaskWorkspaceFilePreview | null;
  originalContent: string;
  draftContent: string;
  newlineStyle: NewlineStyle;
  error: string | null;
}

export interface CheckpointFileEditorModalProps {
  open: boolean;
  taskId: string | null;
  filePaths: string[];
  initialFilePath?: string | null;
  onCancel: () => void;
  onSaved?: () => void;
}

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false }
);

function normalizeEditorContent(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function detectNewlineStyle(value: string): NewlineStyle {
  return value.includes("\r\n") ? "crlf" : "lf";
}

function serializeEditorContent(value: string, newlineStyle: NewlineStyle): string {
  return newlineStyle === "crlf" ? value.replace(/\r?\n/g, "\r\n") : value.replace(/\r\n?/g, "\n");
}

function makeEmptyFileState(): EditableFileState {
  return {
    loading: false,
    loaded: false,
    saving: false,
    preview: null,
    originalContent: "",
    draftContent: "",
    newlineStyle: "lf",
    error: null
  };
}

function toMonacoLanguage(language: string): string {
  switch (language) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "js":
      return "javascript";
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "kt":
      return "kotlin";
    case "rs":
      return "rust";
    case "yml":
      return "yaml";
    case "bash":
      return "shell";
    case "sh":
      return "shell";
    case "md":
      return "markdown";
    case "text":
      return "plaintext";
    default:
      return language;
  }
}

export function CheckpointFileEditorModal({
  open,
  taskId,
  filePaths,
  initialFilePath,
  onCancel,
  onSaved
}: CheckpointFileEditorModalProps) {
  const { mode } = useThemeMode();
  const darkTheme = isDarkAppTheme(mode);
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [files, setFiles] = useState<Record<string, EditableFileState>>({});
  const sessionIdRef = useRef(0);

  const filePathsKey = useMemo(() => filePaths.join("\n"), [filePaths]);

  useEffect(() => {
    if (!open || !taskId || filePaths.length === 0) {
      setSelectedFilePath("");
      setFiles({});
      return;
    }

    sessionIdRef.current += 1;
    setSelectedFilePath(initialFilePath && filePaths.includes(initialFilePath) ? initialFilePath : (filePaths[0] ?? ""));
    setFiles({});
  }, [filePathsKey, initialFilePath, open, taskId]);

  const selectedFile = selectedFilePath ? (files[selectedFilePath] ?? makeEmptyFileState()) : makeEmptyFileState();
  const selectedPreview = selectedFile.preview;
  const selectedIsText = selectedPreview?.kind === "text";
  const selectedDraft = selectedFile.draftContent;
  const selectedDirty = selectedIsText && selectedFile.draftContent !== selectedFile.originalContent;
  const selectedFileLoading = selectedFile.loading;
  const selectedFileLoaded = selectedFile.loaded;
  const dirtyCount = useMemo(
    () =>
      Object.values(files).filter(
        (entry) => entry.preview?.kind === "text" && entry.loaded && entry.draftContent !== entry.originalContent
      ).length,
    [files]
  );
  const hasDirtyFiles = dirtyCount > 0;

  useEffect(() => {
    if (!open || !taskId || !selectedFilePath) {
      return;
    }

    if (selectedFileLoading || selectedFileLoaded) {
      return;
    }

    const sessionId = sessionIdRef.current;
    setFiles((current) => ({
      ...current,
      [selectedFilePath]: {
        ...(current[selectedFilePath] ?? makeEmptyFileState()),
        loading: true,
        error: null
      }
    }));

    void api
      .getTaskWorkspaceFile(taskId, selectedFilePath)
      .then((preview) => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        const newlineStyle = detectNewlineStyle(preview.content);
        const normalizedContent = normalizeEditorContent(preview.content);
        setFiles((current) => ({
          ...current,
          [selectedFilePath]: {
            loading: false,
            loaded: true,
            saving: false,
            preview,
            originalContent: normalizedContent,
            draftContent: normalizedContent,
            newlineStyle,
            error: null
          }
        }));
      })
      .catch((error) => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        setFiles((current) => ({
          ...current,
          [selectedFilePath]: {
            ...(current[selectedFilePath] ?? makeEmptyFileState()),
            loading: false,
            loaded: true,
            saving: false,
            preview: null,
            error: error instanceof Error ? error.message : "Could not open workspace file."
          }
        }));
      });
  }, [open, selectedFileLoaded, selectedFileLoading, selectedFilePath, taskId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      if (!selectedDirty || selectedFile.saving) {
        return;
      }
      void handleSaveSelectedFile();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedDirty, selectedFile.saving]);

  const handleSaveSelectedFile = async (): Promise<void> => {
    if (!taskId || !selectedFilePath || !selectedIsText || !selectedDirty || selectedFile.saving) {
      return;
    }

    setFiles((current) => ({
      ...current,
      [selectedFilePath]: {
        ...(current[selectedFilePath] ?? makeEmptyFileState()),
        saving: true,
        error: null
      }
    }));

    try {
      const persistedContent = serializeEditorContent(selectedDraft, selectedFile.newlineStyle);
      const preview = await api.updateTaskWorkspaceFile(taskId, {
        path: selectedFilePath,
        content: persistedContent
      });
      const normalizedContent = normalizeEditorContent(preview.content);

      setFiles((current) => ({
        ...current,
        [selectedFilePath]: {
          loading: false,
          loaded: true,
          saving: false,
          preview,
          originalContent: normalizedContent,
          draftContent: normalizedContent,
          newlineStyle: detectNewlineStyle(preview.content),
          error: null
        }
      }));
      messageApi.success(`${selectedFilePath} saved`);
      onSaved?.();
      onCancel();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save workspace file.";
      setFiles((current) => ({
        ...current,
        [selectedFilePath]: {
          ...(current[selectedFilePath] ?? makeEmptyFileState()),
          saving: false,
          error: message
        }
      }));
      messageApi.error(message);
    }
  };

  const requestCancel = () => {
    if (!hasDirtyFiles) {
      onCancel();
      return;
    }

    Modal.confirm({
      title: "Discard unsaved file edits?",
      content: "Unsaved changes in this checkpoint editor will be lost.",
      okText: "Discard changes",
      okButtonProps: { danger: true },
      cancelText: "Keep editing",
      onOk: onCancel
    });
  };

  const selectedLanguage = detectCodeLanguage(selectedFilePath || "");
  const selectedLanguageLabel = getCodeLanguageLabel(selectedLanguage);
  const showFileSelector = filePaths.length > 1;
  const selectOptions = filePaths.map((filePath) => {
    const state = files[filePath];
    const dirty = state?.preview?.kind === "text" && state.loaded && state.draftContent !== state.originalContent;
    return {
      label: dirty ? `${filePath} • unsaved` : filePath,
      value: filePath
    };
  });

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        width={960}
        destroyOnClose
        title={
          <Space wrap size={8}>
            <Typography.Text strong>{showFileSelector ? "Edit Checkpoint Files" : "Edit Checkpoint File"}</Typography.Text>
            {selectedFilePath ? <Typography.Text code>{selectedFilePath}</Typography.Text> : null}
            {selectedFilePath ? <Tag>{selectedLanguageLabel}</Tag> : null}
            {dirtyCount > 0 ? <Tag color="gold">{dirtyCount} unsaved</Tag> : null}
          </Space>
        }
        onCancel={requestCancel}
        footer={[
          <Button
            key="save"
            type="primary"
            onClick={() => void handleSaveSelectedFile()}
            disabled={!selectedDirty || !selectedIsText}
            loading={selectedFile.saving}
          >
            Save
          </Button>
        ]}
        styles={{ body: { paddingTop: 12 } }}
      >
        <Flex vertical gap={12}>
          {showFileSelector ? (
            <Flex gap={12} wrap="wrap" align="center">
              <Typography.Text strong>File</Typography.Text>
              <Select
                style={{ minWidth: 360, flex: "1 1 360px" }}
                value={selectedFilePath || undefined}
                options={selectOptions}
                onChange={setSelectedFilePath}
              />
              <Typography.Text type="secondary">
                {filePaths.length} changed file{filePaths.length === 1 ? "" : "s"}
              </Typography.Text>
            </Flex>
          ) : null}

          {!selectedFilePath ? (
            <Alert type="warning" showIcon message="No checkpoint file is available to edit." />
          ) : selectedFile.loading ? (
            <div style={{ paddingBlock: 48, textAlign: "center" }}>
              <Spin size="large" />
            </div>
          ) : selectedFile.error ? (
            <Alert type="error" showIcon message="Could not open workspace file" description={selectedFile.error} />
          ) : !selectedPreview ? (
            <Alert type="warning" showIcon message="File preview is unavailable." />
          ) : selectedPreview.kind !== "text" ? (
            <Alert
              type="info"
              showIcon
              message="Only text files can be edited in this modal"
              description={
                selectedPreview.kind === "image"
                  ? "This checkpoint file is an image. Use the existing image preview instead."
                  : "This checkpoint file is binary or metadata-only and does not support text editing here."
              }
            />
          ) : (
            <MonacoEditor
              key={selectedFilePath}
              height="56vh"
              theme={darkTheme ? "vs-dark" : "vs"}
              language={toMonacoLanguage(selectedLanguage)}
              value={selectedDraft}
              onChange={(value) => {
                const nextValue = value ?? "";
                setFiles((current) => ({
                  ...current,
                  [selectedFilePath]: {
                    ...(current[selectedFilePath] ?? makeEmptyFileState()),
                    preview: current[selectedFilePath]?.preview ?? selectedPreview,
                    loaded: true,
                    draftContent: nextValue,
                    originalContent: current[selectedFilePath]?.originalContent ?? "",
                    newlineStyle: current[selectedFilePath]?.newlineStyle ?? "lf",
                    error: null,
                    saving: current[selectedFilePath]?.saving ?? false,
                    loading: false
                  }
                }));
              }}
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                wordWrap: "off"
              }}
            />
          )}
        </Flex>
      </Modal>
    </>
  );
}
