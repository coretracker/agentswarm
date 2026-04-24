"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Flex, Modal, Select, Space, Spin, Tag, Typography, message } from "antd";
import type { TaskWorkspaceFilePreview } from "@agentswarm/shared-types";
import { api } from "../src/api/client";
import { isDarkAppTheme } from "../src/theme/antd-theme";
import { useThemeMode } from "./theme-provider";
import { detectCodeLanguage, getCodeLanguageLabel, renderHighlightedLine } from "./workspace-file-preview-modal";

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

const monoFontFamily = "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

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

function getFileLines(value: string): string[] {
  return value.length > 0 ? value.split("\n") : [""];
}

function buildLineNumberStyles(darkTheme: boolean): {
  surfaceBorder: string;
  surfaceBackground: string;
  gutterBorder: string;
  gutterBackground: string;
  alternateRowBackground: string;
} {
  return {
    surfaceBorder: darkTheme ? "rgba(255, 255, 255, 0.08)" : "#d9e2db",
    surfaceBackground: darkTheme ? "rgba(255, 255, 255, 0.03)" : "#f6f8f6",
    gutterBorder: darkTheme ? "rgba(255, 255, 255, 0.08)" : "#e5ebe7",
    gutterBackground: darkTheme ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)",
    alternateRowBackground: darkTheme ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.015)"
  };
}

function LineNumberedTextarea({
  value,
  onChange,
  darkTheme,
  filePath,
  language
}: {
  value: string;
  onChange: (value: string) => void;
  darkTheme: boolean;
  filePath: string;
  language: string;
}) {
  const styles = buildLineNumberStyles(darkTheme);
  const lines = useMemo(() => getFileLines(value), [value]);
  const gutterWidth = Math.max(56, String(lines.length || 1).length * 10 + 24);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const backdropContentRef = useRef<HTMLDivElement | null>(null);

  const syncScroll = () => {
    if (!textareaRef.current) {
      return;
    }

    if (gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (backdropContentRef.current) {
      backdropContentRef.current.style.transform = `translate(${-textareaRef.current.scrollLeft}px, ${-textareaRef.current.scrollTop}px)`;
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0;
      textareaRef.current.scrollLeft = 0;
    }
    syncScroll();
  }, [filePath]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${gutterWidth}px minmax(0, 1fr)`,
        height: "56vh",
        border: `1px solid ${styles.surfaceBorder}`,
        borderRadius: 10,
        background: styles.surfaceBackground,
        overflow: "hidden"
      }}
    >
      <div
        ref={gutterRef}
        style={{
          overflow: "hidden",
          borderRight: `1px solid ${styles.gutterBorder}`,
          background: styles.gutterBackground
        }}
      >
        <div
          style={{
            fontFamily: monoFontFamily,
            fontSize: 13,
            lineHeight: 1.65
          }}
        >
          {lines.map((_, index) => {
            const lineNumber = index + 1;
            return (
              <div
                key={`editor-line-${lineNumber}`}
                style={{
                  padding: "0 12px 0 8px",
                  textAlign: "right",
                  userSelect: "none",
                  color: "#8c8c8c",
                  background: lineNumber % 2 === 0 ? styles.alternateRowBackground : "transparent"
                }}
              >
                {lineNumber}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none"
          }}
        >
          <div
            ref={backdropContentRef}
            style={{
              minWidth: "100%",
              padding: "0 16px",
              fontFamily: monoFontFamily,
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: "pre",
              userSelect: "none",
              willChange: "transform"
            }}
          >
            {lines.map((lineText, index) => {
              const lineNumber = index + 1;
              return (
                <div
                  key={`highlight-line-${lineNumber}-${lineText.length}`}
                  style={{
                    minHeight: "1.65em",
                    background: lineNumber % 2 === 0 ? styles.alternateRowBackground : "transparent"
                  }}
                >
                  {renderHighlightedLine(lineText, language)}
                </div>
              );
            })}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          spellCheck={false}
          wrap="off"
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            padding: "0 16px",
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "transparent",
            caretColor: darkTheme ? "rgba(255,255,255,0.92)" : "#1f1f1f",
            WebkitTextFillColor: "transparent",
            fontFamily: monoFontFamily,
            fontSize: 13,
            lineHeight: 1.65,
            whiteSpace: "pre",
            overflow: "auto",
            tabSize: 2,
            zIndex: 1
          }}
        />
      </div>
    </div>
  );
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
          <Button key="cancel" onClick={requestCancel}>
            Close
          </Button>,
          <Button
            key="save"
            type="primary"
            onClick={() => void handleSaveSelectedFile()}
            disabled={!selectedDirty || !selectedIsText}
            loading={selectedFile.saving}
          >
            Save Current File
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
            <LineNumberedTextarea
              value={selectedDraft}
              filePath={selectedFilePath}
              language={selectedLanguage}
              onChange={(nextValue) => {
                setFiles((current) => ({
                  ...current,
                  [selectedFilePath]: {
                    ...(current[selectedFilePath] ?? makeEmptyFileState()),
                    preview: selectedPreview,
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
              darkTheme={darkTheme}
            />
          )}
        </Flex>
      </Modal>
    </>
  );
}
