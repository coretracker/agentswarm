"use client";

import { useEffect, useState } from "react";
import { Card, Collapse, Flex, Spin, Typography } from "antd";
import type { FileData } from "react-diff-view";
import { api, type TaskWorkspaceFilePreview } from "../src/api/client";
import { isImageDiffPath } from "../src/utils/diff";
import { useThemeMode } from "./theme-provider";

export interface TaskDiffPreviewRefs {
  before: string | null;
  after: string | null;
}

interface ImagePreviewState {
  loading: boolean;
  preview: TaskWorkspaceFilePreview | null;
  error: string | null;
}

function getDiffFilePath(file: Pick<FileData, "newPath" | "oldPath">): string {
  return file.newPath || file.oldPath || "";
}

function getDiffFileLabel(file: Pick<FileData, "newPath" | "oldPath">): string {
  return getDiffFilePath(file) || "Changed file";
}

function useTaskImagePreview(taskId: string, filePath: string, ref: string | null): ImagePreviewState {
  const shouldLoad = Boolean(taskId && filePath && ref);
  const [state, setState] = useState<ImagePreviewState>({
    loading: shouldLoad,
    preview: null,
    error: null
  });

  useEffect(() => {
    if (!shouldLoad) {
      setState({ loading: false, preview: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, preview: null, error: null });

    void api
      .getTaskWorkspaceFile(taskId, filePath, { ref })
      .then((preview) => {
        if (cancelled) {
          return;
        }

        if (preview.kind !== "image" || preview.encoding !== "base64") {
          setState({
            loading: false,
            preview: null,
            error: preview.kind === "binary" ? "This file cannot be rendered as an image." : "Image preview is unavailable."
          });
          return;
        }

        setState({ loading: false, preview, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          loading: false,
          preview: null,
          error: error instanceof Error ? error.message : "Failed to load image preview."
        });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, ref, shouldLoad, taskId]);

  return state;
}

function ImagePreviewPane({
  title,
  state
}: {
  title: string;
  state: ImagePreviewState;
}) {
  const { mode } = useThemeMode();
  const surfaceBackground = mode === "dark" ? "rgba(255, 255, 255, 0.03)" : "#f6f8f6";
  const borderColor = mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "#d9e2db";

  return (
    <div style={{ flex: "1 1 280px", minWidth: 0 }}>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        {title}
      </Typography.Text>
      <div
        style={{
          minHeight: 180,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          background: surfaceBackground,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12
        }}
      >
        {state.loading ? (
          <Spin size="small" />
        ) : state.preview && state.preview.mimeType ? (
          <img
            alt={title}
            src={`data:${state.preview.mimeType};base64,${state.preview.content}`}
            style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 6 }}
          />
        ) : (
          <Typography.Text type="secondary" style={{ textAlign: "center" }}>
            {state.error ?? "Preview unavailable."}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

export function TaskBinaryDiffCard({
  file,
  collapseFiles,
  taskId,
  previewRefs,
  previewUnavailableMessage
}: {
  file: FileData;
  collapseFiles: boolean;
  taskId: string;
  previewRefs: TaskDiffPreviewRefs | null;
  previewUnavailableMessage?: string;
}) {
  const fileLabel = getDiffFileLabel(file);
  const filePath = getDiffFilePath(file);
  const isImage = isImageDiffPath(filePath);
  const showBefore = Boolean(previewRefs?.before) && file.type !== "add";
  const showAfter = Boolean(previewRefs?.after) && file.type !== "delete";
  const beforePreview = useTaskImagePreview(taskId, showBefore ? file.oldPath || filePath : "", showBefore ? previewRefs?.before ?? null : null);
  const afterPreview = useTaskImagePreview(taskId, showAfter ? file.newPath || filePath : "", showAfter ? previewRefs?.after ?? null : null);
  const showBeforePane = showBefore && (beforePreview.loading || beforePreview.preview !== null);
  const showAfterPane = showAfter && (afterPreview.loading || afterPreview.preview !== null);

  const content = isImage ? (
    previewRefs ? (
      <Flex gap={12} wrap="wrap">
        {showBeforePane ? <ImagePreviewPane title="Before" state={beforePreview} /> : null}
        {showAfterPane ? <ImagePreviewPane title="After" state={afterPreview} /> : null}
        {!showBeforePane && !showAfterPane ? (
          <Typography.Text type="secondary">
            This image change does not have a previewable before/after image.
          </Typography.Text>
        ) : null}
      </Flex>
    ) : (
      <Typography.Text type="secondary">
        {previewUnavailableMessage ?? "Image preview is unavailable for this diff."}
      </Typography.Text>
    )
  ) : (
    <Typography.Text type="secondary">
      No line-based diff is available for this file. Git reported a binary or metadata-only change.
    </Typography.Text>
  );

  if (collapseFiles) {
    return (
      <Collapse
        size="small"
        defaultActiveKey={[]}
        items={[
          {
            key: "file",
            label: fileLabel,
            children: content
          }
        ]}
      />
    );
  }

  return (
    <Card size="small" title={fileLabel}>
      {content}
    </Card>
  );
}
