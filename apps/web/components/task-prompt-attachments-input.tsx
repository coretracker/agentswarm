"use client";

import { useEffect, useMemo, useRef, type ChangeEvent, type ReactNode } from "react";
import { TASK_PROMPT_ATTACHMENT_MAX_COUNT } from "@agentswarm/shared-types";
import { Button, Card, Flex, Typography } from "antd";
import { formatAttachmentSize, type SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";

interface TaskPromptAttachmentsInputProps {
  files: SelectedTaskPromptImageFile[];
  onChange: (nextFiles: SelectedTaskPromptImageFile[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  description?: ReactNode;
  layout?: "default" | "toolbar";
}

interface PreviewItem {
  id: string;
  name: string;
  sizeBytes: number;
  url: string;
}

export function TaskPromptAttachmentsInput({
  files,
  onChange,
  onError,
  disabled = false,
  description,
  layout = "default"
}: TaskPromptAttachmentsInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previews = useMemo<PreviewItem[]>(
    () =>
      files.map(({ id, file }) => ({
        id,
        name: file.name,
        sizeBytes: file.size,
        url: URL.createObjectURL(file)
      })),
    [files]
  );

  useEffect(
    () => () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    },
    [previews]
  );

  const openPicker = () => {
    if (disabled) {
      return;
    }
    inputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) {
      return;
    }

    const nonImages = selectedFiles.filter((file) => !file.type.startsWith("image/"));
    if (nonImages.length > 0) {
      onError("Only image files can be attached.");
      return;
    }

    const nextFiles = [
      ...files,
      ...selectedFiles.map((file) => ({
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${file.size}-${file.lastModified}`,
        file
      }))
    ];

    if (nextFiles.length > TASK_PROMPT_ATTACHMENT_MAX_COUNT) {
      onError(`You can attach up to ${TASK_PROMPT_ATTACHMENT_MAX_COUNT} images per prompt.`);
      onChange(nextFiles.slice(0, TASK_PROMPT_ATTACHMENT_MAX_COUNT));
      return;
    }

    onChange(nextFiles);
  };

  return (
    <Flex vertical gap={10}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {layout === "toolbar" ? (
        <Flex justify="flex-start" align="center" gap={12} wrap="wrap">
          <Flex gap={8} wrap align="center">
            <Button onClick={openPicker} disabled={disabled}>
              Attach Images
            </Button>
            {files.length > 0 ? (
              <Button onClick={() => onChange([])}>
                Clear
              </Button>
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {files.length}/{TASK_PROMPT_ATTACHMENT_MAX_COUNT} selected
            </Typography.Text>
          </Flex>
        </Flex>
      ) : (
        <Flex justify="space-between" align="center" gap={12} wrap="wrap">
          <Flex vertical gap={2}>
            <Typography.Text strong>Images</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {files.length}/{TASK_PROMPT_ATTACHMENT_MAX_COUNT} selected
            </Typography.Text>
          </Flex>
          <Flex gap={8} wrap align="center">
            {files.length > 0 ? (
              <Button onClick={() => onChange([])}>
                Clear
              </Button>
            ) : null}
            <Button onClick={openPicker} disabled={disabled}>
              Attach Images
            </Button>
          </Flex>
        </Flex>
      )}
      {description ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {description}
        </Typography.Text>
      ) : null}
      {previews.length > 0 ? (
        <Flex gap={12} wrap>
          {previews.map((preview) => (
            <Card
              key={preview.id}
              size="small"
              bodyStyle={{ padding: 10 }}
              style={{ width: 180 }}
              actions={[
                <Button
                  key="remove"
                  type="text"
                  size="small"
                  onClick={() => onChange(files.filter((file) => file.id !== preview.id))}
                >
                  Remove
                </Button>
              ]}
            >
              <Flex vertical gap={8}>
                <img
                  src={preview.url}
                  alt={preview.name}
                  style={{
                    width: "100%",
                    height: 110,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.08)"
                  }}
                />
                <div>
                  <Typography.Text strong ellipsis={{ tooltip: preview.name }} style={{ display: "block" }}>
                    {preview.name}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatAttachmentSize(preview.sizeBytes)}
                  </Typography.Text>
                </div>
              </Flex>
            </Card>
          ))}
        </Flex>
      ) : null}
    </Flex>
  );
}
