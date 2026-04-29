"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskWorkspaceFilePreview, TaskWorkspaceFileTreeEntry } from "@agentswarm/shared-types";
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Flex, Input, Space, Spin, Tag, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { api } from "../src/api/client";
import { isDarkAppTheme } from "../src/theme/antd-theme";
import type { WorkspaceFileLinkTarget } from "../src/utils/workspace-file-links";
import { useThemeMode } from "./theme-provider";
import { detectCodeLanguage, getCodeLanguageLabel } from "./workspace-file-preview-modal";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false }
);

interface MutableTreeNode {
  key: string;
  name: string;
  kind: "file" | "directory";
  children: Map<string, MutableTreeNode>;
}

interface TaskFilesTabProps {
  taskId: string;
  active: boolean;
  openTarget?: WorkspaceFileLinkTarget | null;
  onOpenTargetHandled?: () => void;
}

function toMonacoLanguage(language: string): string {
  switch (language) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
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
    case "yaml":
      return "yaml";
    case "bash":
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toTreeData(nodes: Map<string, MutableTreeNode>): DataNode[] {
  return Array.from(nodes.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .map((node) => ({
      key: node.key,
      title: node.name,
      isLeaf: node.kind === "file",
      children: node.kind === "directory" ? toTreeData(node.children) : undefined
    }));
}

function buildTreeData(entries: TaskWorkspaceFileTreeEntry[], query: string): DataNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePaths = new Set<string>();

  if (normalizedQuery.length > 0) {
    for (const entry of entries) {
      if (entry.kind !== "file") {
        continue;
      }
      if (!entry.path.toLowerCase().includes(normalizedQuery)) {
        continue;
      }

      const segments = entry.path.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        visiblePaths.add(segments.slice(0, index + 1).join("/"));
      }
    }
  }

  const root = new Map<string, MutableTreeNode>();
  const ordered = [...entries].sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));
  for (const entry of ordered) {
    if (normalizedQuery.length > 0 && !visiblePaths.has(entry.path)) {
      continue;
    }

    const segments = entry.path.split("/");
    let currentLevel = root;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] ?? "";
      const key = segments.slice(0, index + 1).join("/");
      const isLeaf = index === segments.length - 1;
      const kind: "file" | "directory" = isLeaf ? entry.kind : "directory";
      const existing = currentLevel.get(name);

      if (!existing) {
        const created: MutableTreeNode = {
          key,
          name,
          kind,
          children: new Map()
        };
        currentLevel.set(name, created);
        currentLevel = created.children;
        continue;
      }

      if (existing.kind === "directory" && kind === "file") {
        existing.kind = "file";
      }
      currentLevel = existing.children;
    }
  }

  return toTreeData(root);
}

export function TaskFilesTab({ taskId, active, openTarget, onOpenTargetHandled }: TaskFilesTabProps) {
  const { mode } = useThemeMode();
  const darkTheme = isDarkAppTheme(mode);
  const treeRequestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const editorRef = useRef<{ revealLineInCenter: (lineNumber: number) => void; setPosition: (position: { lineNumber: number; column: number }) => void } | null>(null);

  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeEntries, setTreeEntries] = useState<TaskWorkspaceFileTreeEntry[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileState, setFileState] = useState<{
    loading: boolean;
    preview: TaskWorkspaceFilePreview | null;
    error: string | null;
  }>({
    loading: false,
    preview: null,
    error: null
  });

  useEffect(() => {
    setExecutionId(null);
    setSelectedFilePath("");
    setSelectedLine(null);
    setTreeEntries([]);
    setFileState({
      loading: false,
      preview: null,
      error: null
    });
    setTreeError(null);
    setTreeTruncated(false);
    setFilterText("");
  }, [taskId]);

  useEffect(() => {
    if (!openTarget || openTarget.taskId !== taskId) {
      return;
    }

    setExecutionId(openTarget.executionId ?? null);
    setSelectedFilePath(openTarget.filePath);
    setSelectedLine(openTarget.line);
    onOpenTargetHandled?.();
  }, [onOpenTargetHandled, openTarget, taskId]);

  const loadTree = useCallback(async () => {
    const requestId = treeRequestIdRef.current + 1;
    treeRequestIdRef.current = requestId;

    setTreeLoading(true);
    setTreeError(null);
    try {
      const result = await api.getTaskWorkspaceFiles(taskId, {
        executionId,
        limit: 5000
      });
      if (treeRequestIdRef.current !== requestId) {
        return;
      }

      const files = result.entries.filter((entry) => entry.kind === "file");
      setTreeEntries(result.entries);
      setTreeTruncated(result.truncated);
      setSelectedFilePath((current) => {
        if (current && files.some((entry) => entry.path === current)) {
          return current;
        }
        return files[0]?.path ?? "";
      });
    } catch (error) {
      if (treeRequestIdRef.current !== requestId) {
        return;
      }
      setTreeEntries([]);
      setTreeTruncated(false);
      setTreeError(error instanceof Error ? error.message : "Could not load workspace files.");
      setSelectedFilePath("");
    } finally {
      if (treeRequestIdRef.current === requestId) {
        setTreeLoading(false);
      }
    }
  }, [executionId, taskId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadTree();
  }, [active, loadTree, refreshKey]);

  useEffect(() => {
    if (!selectedFilePath) {
      setFileState({
        loading: false,
        preview: null,
        error: null
      });
      return;
    }

    const requestId = fileRequestIdRef.current + 1;
    fileRequestIdRef.current = requestId;
    setFileState((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    void api
      .getTaskWorkspaceFile(taskId, selectedFilePath, { executionId })
      .then((preview) => {
        if (fileRequestIdRef.current !== requestId) {
          return;
        }
        setFileState({
          loading: false,
          preview,
          error: null
        });
      })
      .catch((error) => {
        if (fileRequestIdRef.current !== requestId) {
          return;
        }
        setFileState({
          loading: false,
          preview: null,
          error: error instanceof Error ? error.message : "Could not open workspace file."
        });
      });
  }, [executionId, selectedFilePath, taskId]);

  useEffect(() => {
    if (!selectedLine || !fileState.preview || fileState.preview.kind !== "text") {
      return;
    }
    editorRef.current?.revealLineInCenter(selectedLine);
    editorRef.current?.setPosition({ lineNumber: selectedLine, column: 1 });
  }, [fileState.preview, selectedLine]);

  const selectedLanguage = detectCodeLanguage(selectedFilePath || "");
  const treeData = useMemo(() => buildTreeData(treeEntries, filterText), [filterText, treeEntries]);

  return (
    <Flex gap={12} style={{ width: "100%", minHeight: "64vh", alignItems: "stretch" }}>
      <Flex
        vertical
        gap={10}
        style={{
          width: 360,
          minWidth: 280,
          border: "1px solid rgba(128, 128, 128, 0.22)",
          borderRadius: 8,
          padding: 12,
          overflow: "hidden"
        }}
      >
        <Flex justify="space-between" align="center" gap={8}>
          <Typography.Text strong>Workspace Files</Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setRefreshKey((current) => current + 1)}>
            Refresh
          </Button>
        </Flex>
        <Input
          placeholder="Filter files"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          allowClear
        />
        {executionId ? (
          <Space wrap size={8}>
            <Tag color="cyan">Execution {executionId}</Tag>
            <Button
              size="small"
              onClick={() => {
                setExecutionId(null);
                setSelectedLine(null);
              }}
            >
              Use Current Task Workspace
            </Button>
          </Space>
        ) : null}
        {treeTruncated ? (
          <Alert
            type="info"
            showIcon
            message="File list truncated to first 5,000 entries."
          />
        ) : null}
        {treeLoading ? (
          <Flex justify="center" style={{ paddingTop: 32 }}>
            <Spin />
          </Flex>
        ) : treeError ? (
          <Alert type="error" showIcon message="Could not load files" description={treeError} />
        ) : treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No files found" />
        ) : (
          <Tree
            blockNode
            showLine
            height={560}
            selectedKeys={selectedFilePath ? [selectedFilePath] : []}
            treeData={treeData}
            onSelect={(keys, info) => {
              const key = String(keys[0] ?? "");
              if (!key || !info.node.isLeaf) {
                return;
              }
              setSelectedFilePath(key);
              setSelectedLine(null);
            }}
          />
        )}
      </Flex>

      <Flex
        vertical
        gap={10}
        style={{
          flex: 1,
          minWidth: 0,
          border: "1px solid rgba(128, 128, 128, 0.22)",
          borderRadius: 8,
          padding: 12
        }}
      >
        <Space wrap size={8}>
          <Typography.Text strong>{selectedFilePath || "Select a file"}</Typography.Text>
          {selectedFilePath ? <Tag>{getCodeLanguageLabel(selectedLanguage)}</Tag> : null}
          {fileState.preview ? <Tag>{formatBytes(fileState.preview.sizeBytes)}</Tag> : null}
          {selectedLine ? <Tag color="blue">Line {selectedLine}</Tag> : null}
        </Space>

        {!selectedFilePath ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a file from the tree to view it." />
        ) : fileState.loading ? (
          <Flex justify="center" style={{ paddingTop: 48 }}>
            <Spin />
          </Flex>
        ) : fileState.error ? (
          <Alert type="error" showIcon message="Could not load file" description={fileState.error} />
        ) : !fileState.preview ? (
          <Alert type="warning" showIcon message="File preview unavailable." />
        ) : fileState.preview.kind !== "text" ? (
          <Alert
            type="info"
            showIcon
            message="Only text files are shown in this editor"
            description={
              fileState.preview.kind === "image"
                ? "This file is an image. Use task history links if you need image preview."
                : "This file is binary. Text preview is not available."
            }
          />
        ) : (
          <MonacoEditor
            key={`${executionId ?? "workspace"}:${fileState.preview.path}`}
            path={fileState.preview.path}
            height="64vh"
            theme={darkTheme ? "vs-dark" : "vs"}
            language={toMonacoLanguage(selectedLanguage)}
            value={fileState.preview.content}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            options={{
              readOnly: true,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: "off"
            }}
          />
        )}
      </Flex>
    </Flex>
  );
}
