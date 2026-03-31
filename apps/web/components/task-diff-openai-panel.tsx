"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getDefaultModelForProvider,
  getEffortOptionsForProvider,
  type ProviderProfile,
  type TaskLiveDiff
} from "@agentswarm/shared-types";
import { Alert, Button, Card, Collapse, Flex, Input, Modal, Select, Space, Spin, Typography, message } from "antd";
import { Diff, Hunk, getChangeKey, type ChangeData, type FileData } from "react-diff-view";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../src/api/client";
import { useProviderModels } from "../src/hooks/useProviderModels";
import { normalizeDiffForRendering, parseRenderableDiff } from "../src/utils/diff";

function buildSnippetFromSelection(file: FileData, selectedKeys: string[]): string {
  const selected = new Set(selectedKeys);
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      const key = getChangeKey(change);
      if (selected.has(key)) {
        const prefix = change.type === "insert" ? "+" : change.type === "delete" ? "-" : " ";
        lines.push(prefix + (change.content ?? ""));
      }
    }
  }
  return lines.join("\n");
}

function buildSnippetFromFile(file: FileData): string {
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      const prefix = change.type === "insert" ? "+" : change.type === "delete" ? "-" : " ";
      lines.push(prefix + (change.content ?? ""));
    }
  }
  return lines.join("\n");
}

/** Keeps selection across live-diff polling when the underlying change keys are unchanged. */
function usePersistentChangeSelect(file: FileData, selectionResetToken: string) {
  const [selected, setSelected] = useState<string[]>([]);
  const lastValidSigRef = useRef("");
  const lastResetTokenRef = useRef(selectionResetToken);

  const toggleSelection = useCallback((args: { change: ChangeData | null }) => {
    if (!args.change) {
      return;
    }
    const key = getChangeKey(args.change);
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  useEffect(() => {
    const valid = new Set<string>();
    for (const h of file.hunks) {
      for (const c of h.changes) {
        valid.add(getChangeKey(c));
      }
    }
    const sig = [...valid].sort().join("|");

    if (selectionResetToken !== lastResetTokenRef.current) {
      lastResetTokenRef.current = selectionResetToken;
      lastValidSigRef.current = sig;
      setSelected([]);
      return;
    }

    if (sig === lastValidSigRef.current) {
      return;
    }
    lastValidSigRef.current = sig;
    setSelected((prev) => prev.filter((k) => valid.has(k)));
  }, [file, selectionResetToken]);

  return [selected, toggleSelection] as const;
}

function DiffFileOpenAiCard({
  file,
  collapseFiles,
  workspaceReady,
  selectionResetToken,
  onOpenConfig
}: {
  file: FileData;
  collapseFiles: boolean;
  workspaceReady: boolean;
  selectionResetToken: string;
  onOpenConfig: (filePath: string, snippet: string) => void;
}) {
  const [selectedChanges, toggleSelection] = usePersistentChangeSelect(file, selectionResetToken);
  const filePath = file.newPath || file.oldPath || "";
  const fileLabel = filePath || "Changed file";

  const openConfig = (e: React.MouseEvent) => {
    e.stopPropagation();
    const snippet =
      selectedChanges.length > 0 ? buildSnippetFromSelection(file, selectedChanges) : buildSnippetFromFile(file);
    onOpenConfig(filePath, snippet);
  };

  const diffEl = (
    <Diff
      viewType="unified"
      diffType={file.type}
      hunks={file.hunks}
      selectedChanges={selectedChanges}
      gutterEvents={{ onClick: toggleSelection }}
      codeEvents={{ onClick: toggleSelection }}
    >
      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
    </Diff>
  );

  const actions = (
    <Space wrap size="small" onClick={(e) => e.stopPropagation()}>
      <Button
        size="small"
        type="primary"
        disabled={!workspaceReady}
        onClick={openConfig}
      >
        Ask
      </Button>
    </Space>
  );

  if (collapseFiles) {
    return (
      <Collapse
        size="small"
        defaultActiveKey={[]}
        items={[
          {
            key: "file",
            label: (
              <Flex align="center" justify="space-between" gap={12} wrap="wrap">
                <Typography.Text style={{ wordBreak: "break-all" }}>{fileLabel}</Typography.Text>
                {actions}
              </Flex>
            ),
            children: diffEl
          }
        ]}
      />
    );
  }

  return (
    <Card
      size="small"
      title={
        <Flex align="center" justify="space-between" gap={12} wrap="wrap">
          <Typography.Text style={{ wordBreak: "break-all" }}>{fileLabel}</Typography.Text>
          {actions}
        </Flex>
      }
    >
      {diffEl}
    </Card>
  );
}

export interface TaskDiffOpenAiPanelProps {
  diffText: string;
  emptyMessage: string;
  collapseFiles: boolean;
  taskId: string;
  liveDiff: TaskLiveDiff | null;
  /** Clears line selection when this value changes (e.g. compare vs working toggle). */
  selectionResetToken: string;
}

export function TaskDiffOpenAiPanel({
  diffText,
  emptyMessage,
  collapseFiles,
  taskId,
  liveDiff,
  selectionResetToken
}: TaskDiffOpenAiPanelProps): ReactNode {
  const [openAiModel, setOpenAiModel] = useState<string>("gpt-5.4");
  const [openAiEffort, setOpenAiEffort] = useState<ProviderProfile>("high");
  const [instruction, setInstruction] = useState("");
  const { models: codexModels, loading: codexModelsLoading } = useProviderModels("codex");

  const [configOpen, setConfigOpen] = useState(false);
  const [pendingFilePath, setPendingFilePath] = useState("");
  const [pendingSnippet, setPendingSnippet] = useState("");

  const [resultOpen, setResultOpen] = useState(false);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultMarkdown, setResultMarkdown] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api
      .getSettings()
      .then((s) => {
        if (!cancelled) {
          setOpenAiModel(s.codexDefaultModel || getDefaultModelForProvider("codex") || "gpt-5.4");
          setOpenAiEffort(s.codexDefaultEffort);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const workspaceReady = liveDiff?.live === true;

  const openConfigModal = useCallback((filePath: string, snippet: string) => {
    setPendingFilePath(filePath);
    setPendingSnippet(snippet);
    setConfigOpen(true);
  }, []);

  const runAssist = useCallback(async () => {
    setConfigOpen(false);
    setResultOpen(true);
    setResultLoading(true);
    setResultMarkdown("");
    try {
      const res = await api.openAiDiffAssist(taskId, {
        model: openAiModel,
        providerProfile: openAiEffort,
        userPrompt: instruction,
        filePath: pendingFilePath,
        selectedSnippet: pendingSnippet
      });
      setResultMarkdown(res.text.trim() || "_Empty response._");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      message.error(msg);
      setResultOpen(false);
    } finally {
      setResultLoading(false);
    }
  }, [
    taskId,
    openAiModel,
    openAiEffort,
    instruction,
    pendingFilePath,
    pendingSnippet
  ]);

  if (!diffText.trim()) {
    return (
      <Card size="small">
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "\"SFMono-Regular\", Consolas, monospace" }}
        >
          {emptyMessage}
        </Typography.Paragraph>
      </Card>
    );
  }

  let files: FileData[];
  try {
    files = parseRenderableDiff(diffText);
    if (files.length === 0) {
      throw new Error("No diff files parsed");
    }
  } catch {
    return (
      <Card size="small">
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "\"SFMono-Regular\", Consolas, monospace" }}
        >
          {normalizeDiffForRendering(diffText) || diffText}
        </Typography.Paragraph>
      </Card>
    );
  }

  return (
    <>
      {!workspaceReady ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="OpenAI on diff needs a live workspace"
          description="Wait until the task workspace is available, then ask about selected lines or the whole file."
        />
      ) : null}

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {files.map((file) => (
          <DiffFileOpenAiCard
            key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}`}
            file={file}
            collapseFiles={collapseFiles}
            workspaceReady={workspaceReady}
            selectionResetToken={selectionResetToken}
            onOpenConfig={openConfigModal}
          />
        ))}
      </Space>

      <Modal
        title="OpenAI (diff selection)"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => void runAssist()}
        okText="Ask"
        okButtonProps={{ disabled: !workspaceReady }}
        width={560}
        destroyOnClose={false}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {pendingSnippet.trim().length > 0
            ? "Sends the selected diff lines or file diff context together with the current workspace file to the model. Nothing is written to disk."
            : "Asks about the current workspace file. Nothing is written to disk."}
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
          File
        </Typography.Text>
        <Typography.Paragraph copyable style={{ marginBottom: 12, wordBreak: "break-all" }}>
          {pendingFilePath || "—"}
        </Typography.Paragraph>
        <Flex gap={16} wrap="wrap" style={{ marginBottom: 12 }}>
          <div style={{ minWidth: 160, flex: "1 1 180px" }}>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
              Model
            </Typography.Text>
            <Select
              value={openAiModel}
              options={codexModels}
              loading={codexModelsLoading}
              showSearch
              optionFilterProp="label"
              onChange={(v) => setOpenAiModel(v)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 140, flex: "0 1 160px" }}>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
              Effort
            </Typography.Text>
            <Select
              value={openAiEffort}
              options={getEffortOptionsForProvider("codex")}
              onChange={(v) => setOpenAiEffort(v)}
              style={{ width: "100%" }}
            />
          </div>
        </Flex>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
          Instruction (optional)
        </Typography.Text>
        <Input.TextArea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="What should the model do with the selected lines?"
        />
      </Modal>

      <Modal
        title="OpenAI result"
        open={resultOpen}
        onCancel={() => setResultOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setResultOpen(false)}>
            Close
          </Button>
        ]}
        width={720}
        destroyOnClose
      >
        {resultLoading ? (
          <Flex justify="center" style={{ padding: 32 }}>
            <Spin />
          </Flex>
        ) : (
          <div className="task-diff-openai-result">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{resultMarkdown}</ReactMarkdown>
          </div>
        )}
      </Modal>
    </>
  );
}
