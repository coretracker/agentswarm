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
  useWorkspaceAfter?: boolean;
}

interface ImagePreviewState {
  loading: boolean;
  preview: TaskWorkspaceFilePreview | null;
  error: string | null;
}

function getPreviewErrorMessage(preview: TaskWorkspaceFilePreview): string {
  return preview.kind === "binary" ? "This file cannot be rendered as an image." : "Image preview is unavailable.";
}

function getDiffFilePath(file: Pick<FileData, "newPath" | "oldPath">): string {
  return file.newPath || file.oldPath || "";
}

function getDiffFileLabel(file: Pick<FileData, "newPath" | "oldPath">): string {
  return getDiffFilePath(file) || "Changed file";
}

function useTaskImagePreview(
  taskId: string,
  filePath: string,
  ref: string | null,
  fallbackRef?: string | null
): ImagePreviewState {
  const shouldLoad = Boolean(taskId && filePath);
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

    const hasFallback = fallbackRef !== undefined && fallbackRef !== ref;
    const loadPreview = async (previewRef: string | null): Promise<ImagePreviewState> => {
      try {
        const preview = await api.getTaskWorkspaceFile(taskId, filePath, previewRef ? { ref: previewRef } : undefined);

        if (preview.kind !== "image" || preview.encoding !== "base64") {
          return {
            loading: false,
            preview: null,
            error: getPreviewErrorMessage(preview)
          };
        }

        return { loading: false, preview, error: null };
      } catch (error: unknown) {
        return {
          loading: false,
          preview: null,
          error: error instanceof Error ? error.message : "Failed to load image preview."
        };
      }
    };

    void loadPreview(ref)
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        if (result.preview || !hasFallback) {
          setState(result);
          return;
        }

        const fallbackResult = await loadPreview(fallbackRef ?? null);
        if (cancelled) {
          return;
        }

        setState(
          fallbackResult.preview
            ? fallbackResult
            : {
                loading: false,
                preview: null,
                error: fallbackResult.error ?? result.error ?? "Failed to load image preview."
              }
        );
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackRef, filePath, ref, shouldLoad, taskId]);

  return state;
}

function isAddedBinaryDiff(file: Pick<FileData, "oldRevision">): boolean {
  return file.oldRevision === "0000000";
}

function isDeletedBinaryDiff(file: Pick<FileData, "newRevision">): boolean {
  return file.newRevision === "0000000";
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
  previewUnavailableMessage,
  framed = true
}: {
  file: FileData;
  collapseFiles: boolean;
  taskId: string;
  previewRefs: TaskDiffPreviewRefs | null;
  previewUnavailableMessage?: string;
  framed?: boolean;
}) {
  const fileLabel = getDiffFileLabel(file);
  const filePath = getDiffFilePath(file);
  const isImage = isImageDiffPath(filePath);
  const isAdded = isAddedBinaryDiff(file);
  const isDeleted = isDeletedBinaryDiff(file);
  const showBefore = Boolean(previewRefs?.before) && !isAdded;
  const showAfter = (Boolean(previewRefs?.after) || previewRefs?.useWorkspaceAfter === true) && !isDeleted;
  const beforePreview = useTaskImagePreview(taskId, showBefore ? file.oldPath || filePath : "", showBefore ? previewRefs?.before ?? null : null);
  const afterPreview = useTaskImagePreview(
    taskId,
    showAfter ? file.newPath || filePath : "",
    showAfter ? previewRefs?.after ?? null : null,
    previewRefs?.useWorkspaceAfter && previewRefs?.after ? null : undefined
  );
  const showBeforePane = showBefore;
  const showAfterPane = showAfter;

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

  if (!framed) {
    return content;
  }

  return (
    <Card size="small" title={fileLabel}>
      {content}
    </Card>
  );
}
