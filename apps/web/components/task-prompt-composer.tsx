"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ClearOutlined, SendOutlined, SettingOutlined } from "@ant-design/icons";
import type { TaskMessageAction } from "@verft/shared-types";
import { Button, Card, Divider, Flex, Mentions, Popconfirm, Select, Space, Spin, Tooltip, theme } from "antd";
import type { MentionsProps } from "antd";
import { TaskPromptAttachmentsInput } from "./task-prompt-attachments-input";
import type { SelectedTaskPromptImageFile } from "../src/utils/task-prompt-attachments";

export type TaskPromptComposerAction = TaskMessageAction | "terminal";

export interface TaskPromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  settingsDisabled?: boolean;
  onOpenSettings: () => void;
  modelValue: string;
  modelOptions: Array<{ label: string; value: string; disabled?: boolean }>;
  modelLoading?: boolean;
  onModelChange: (value: string) => void;
  mentionOptions: MentionsProps["options"];
  mentionLoading?: boolean;
  onMentionSearch: (searchText: string, prefix: string) => void;
  attachments: SelectedTaskPromptImageFile[];
  onAttachmentsChange: (files: SelectedTaskPromptImageFile[]) => void;
  onAttachmentError: (errorMessage: string) => void;
  showAttachments: boolean;
  attachmentsDisabled?: boolean;
  actionValue: TaskPromptComposerAction;
  actionOptions: Array<{ label: string; value: TaskPromptComposerAction; disabled?: boolean }>;
  actionDisabled?: boolean;
  onActionChange: (action: TaskPromptComposerAction) => void;
  submitLabel: string;
  submitDisabled?: boolean;
  submitLoading?: boolean;
  onSubmit: () => void;
  clearDisabled?: boolean;
  onClear: () => void;
  footerActions?: ReactNode;
  footerNote?: ReactNode;
}

export function TaskPromptComposer({
  value,
  onChange,
  placeholder,
  disabled = false,
  settingsDisabled = false,
  onOpenSettings,
  modelValue,
  modelOptions,
  modelLoading = false,
  onModelChange,
  mentionOptions,
  mentionLoading = false,
  onMentionSearch,
  attachments,
  onAttachmentsChange,
  onAttachmentError,
  showAttachments,
  attachmentsDisabled = false,
  actionValue,
  actionOptions,
  actionDisabled = false,
  onActionChange,
  submitLabel,
  submitDisabled = false,
  submitLoading = false,
  onSubmit,
  clearDisabled = false,
  onClear,
  footerActions = null,
  footerNote = null
}: TaskPromptComposerProps) {
  const { token } = theme.useToken();
  const attachmentControl = showAttachments ? (
    <TaskPromptAttachmentsInput
      files={attachments}
      onChange={onAttachmentsChange}
      onError={onAttachmentError}
      disabled={attachmentsDisabled}
      layout="toolbar"
    />
  ) : null;
  const hasSecondaryActions = Boolean(footerActions || attachmentControl);
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    onSubmit();
  };

  return (
    <Card
      size="small"
      style={{ borderRadius: 8 }}
      styles={{
        body: {
          padding: 12
        }
      }}
    >
      <Flex vertical gap={10}>
        <Flex gap={8} align="center" wrap="wrap">
          <Select
            aria-label="Model"
            showSearch
            value={modelValue}
            options={modelOptions}
            loading={modelLoading}
            onChange={onModelChange}
            optionFilterProp="label"
            placeholder="Select model"
            style={{ minWidth: 240, flex: "1 1 280px" }}
            disabled={settingsDisabled}
          />
          <Tooltip title="Settings">
            <Button
              icon={<SettingOutlined />}
              aria-label="Settings"
              onClick={onOpenSettings}
              disabled={settingsDisabled}
            />
          </Tooltip>
        </Flex>

        <div
          style={{
            overflow: "hidden",
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            background: disabled ? token.colorBgContainerDisabled : token.colorBgContainer
          }}
        >
          <Mentions
            variant="borderless"
            autoSize={{ minRows: 4, maxRows: 14 }}
            prefix="@"
            value={value}
            onChange={onChange}
            options={mentionOptions}
            filterOption={false}
            notFoundContent={mentionLoading ? <Spin size="small" /> : "No files found"}
            onSearch={onMentionSearch}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            style={{
              width: "100%",
              resize: "none",
              padding: "12px 12px 10px",
              fontSize: 14,
              lineHeight: 1.5,
              background: "transparent"
            }}
          />
          {showAttachments && attachments.length > 0 ? (
            <>
              <Divider style={{ margin: 0 }} />
              <div style={{ padding: "8px 10px", background: token.colorFillQuaternary }}>
                {attachmentControl}
              </div>
            </>
          ) : null}
        </div>

        <Flex justify="space-between" align="center" gap={12} wrap="wrap">
          <div
            style={{
              flex: "1 1 260px",
              minWidth: 0,
              display: hasSecondaryActions ? "flex" : "none"
            }}
          >
            <Flex gap={8} align="center" wrap="wrap">
              {attachments.length === 0 ? attachmentControl : null}
              {footerActions}
            </Flex>
          </div>
          <div
            style={{
              flex: "0 1 auto",
              maxWidth: "100%"
            }}
          >
            <Space.Compact size="middle" style={{ maxWidth: "100%" }}>
              <Select
                aria-label="Task action"
                value={actionValue}
                options={actionOptions}
                disabled={actionDisabled}
                onChange={onActionChange}
                style={{ minWidth: 116 }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={submitLoading}
                disabled={submitDisabled}
                onClick={onSubmit}
              >
                {submitLabel}
              </Button>
              <Popconfirm
                title="Clear composer?"
                description="This will clear the message input, selected reference images, and reset the settings to this task's defaults."
                okText="Clear"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
                placement="top"
                disabled={clearDisabled}
                onConfirm={onClear}
              >
                <Tooltip title="Clear composer">
                  <Button icon={<ClearOutlined />} aria-label="Clear composer" disabled={clearDisabled} />
                </Tooltip>
              </Popconfirm>
            </Space.Compact>
          </div>
        </Flex>
        {footerNote ? (
          <>
            <Divider style={{ margin: "8px 0 0" }} />
            {footerNote}
          </>
        ) : null}
      </Flex>
    </Card>
  );
}
