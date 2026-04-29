"use client";

import dynamic from "next/dynamic";
import { LoadingOutlined, ReloadOutlined } from "@ant-design/icons";
import type { TaskWorkspaceFilePreview, TaskWorkspaceFileTreeEntryKind } from "@agentswarm/shared-types";
import { Alert, Button, Empty, Flex, Input, Space, Spin, Tag, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../src/api/client";
import { isDarkAppTheme } from "../src/theme/antd-theme";
import type { WorkspaceFileLinkTarget } from "../src/utils/workspace-file-links";
import { useThemeMode } from "./theme-provider";
import { detectCodeLanguage, getCodeLanguageLabel } from "./workspace-file-preview-modal";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false }
);

interface TaskFilesTabProps {
  taskId: string;
  active: boolean;
  openTarget?: WorkspaceFileLinkTarget | null;
  onOpenTargetHandled?: () => void;
}

interface MutableTreeNode {
  key: string;
  name: string;
  kind: TaskWorkspaceFileTreeEntryKind;
  children: Map<string, MutableTreeNode>;
}

function normalizeDirectoryPrefix(value?: string | null): string {
  return (value ?? "").trim().replace(/^\/+|\/+$/g, "");
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

function getParentDirectories(filePath: string): string[] {
  const normalized = normalizeDirectoryPrefix(filePath);
  if (!normalized) {
    return [""];
  }

  const segments = normalized.split("/");
  const directories = [""];
  for (let index = 0; index < Math.max(0, segments.length - 1); index += 1) {
    directories.push(segments.slice(0, index + 1).join("/"));
  }
  return directories;
}

function toTreeData(nodes: Map<string, MutableTreeNode>, loadingDirectories: Set<string>): DataNode[] {
  return Array.from(nodes.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .map((node) => ({
      key: node.key,
      title:
        node.kind === "directory" && loadingDirectories.has(node.key) ? (
          <Space size={6}>
            <span>{node.name}</span>
            <LoadingOutlined />
          </Space>
        ) : (
          node.name
        ),
      isLeaf: node.kind === "file",
      children: node.kind === "directory" ? toTreeData(node.children, loadingDirectories) : undefined
    }));
}

function buildTreeData(
  entryKindsByPath: Record<string, TaskWorkspaceFileTreeEntryKind>,
  query: string,
  loadingDirectories: Set<string>
): DataNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePaths = new Set<string>();

  const entries = Object.entries(entryKindsByPath).map(([path, kind]) => ({ path, kind }));

  if (normalizedQuery.length > 0) {
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.path.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      const segments = entry.path.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        visiblePaths.add(segments.slice(0, index + 1).join("/"));
      }
    }
  }

  const root = new Map<string, MutableTreeNode>();
  const orderedEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));

  for (const entry of orderedEntries) {
    if (normalizedQuery.length > 0 && !visiblePaths.has(entry.path)) {
      continue;
    }

    const segments = entry.path.split("/");
    let currentLevel = root;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] ?? "";
      const key = segments.slice(0, index + 1).join("/");
      const isLeaf = index === segments.length - 1;
      const kind: TaskWorkspaceFileTreeEntryKind = isLeaf ? entry.kind : "directory";
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

      currentLevel = existing.children;
    }
  }

  return toTreeData(root, loadingDirectories);
}

export function TaskFilesTab({ taskId, active, openTarget, onOpenTargetHandled }: TaskFilesTabProps) {
  const { mode } = useThemeMode();
  const darkTheme = isDarkAppTheme(mode);
  const editorRef = useRef<{
    revealLineInCenter: (lineNumber: number) => void;
    setPosition: (position: { lineNumber: number; column: number }) => void;
  } | null>(null);

  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());

  const [treeEntryKindsByPath, setTreeEntryKindsByPath] = useState<Record<string, TaskWorkspaceFileTreeEntryKind>>({});
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [truncationNotice, setTruncationNotice] = useState<string | null>(null);
  const [treeRootLoading, setTreeRootLoading] = useState(false);

  const [executionId, setExecutionId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<string[]>([]);
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

  const resetTreeState = useCallback(() => {
    loadedDirectoriesRef.current = new Set();
    loadingDirectoriesRef.current = new Set();
    setTreeEntryKindsByPath({});
    setLoadedDirectories(new Set());
    setLoadingDirectories(new Set());
    setTreeError(null);
    setTreeRootLoading(false);
    setTruncationNotice(null);
    setExpandedDirectoryKeys([]);
  }, []);

  const loadDirectory = useCallback(
    async (prefix?: string | null): Promise<void> => {
      const normalizedPrefix = normalizeDirectoryPrefix(prefix);

      if (loadedDirectoriesRef.current.has(normalizedPrefix) || loadingDirectoriesRef.current.has(normalizedPrefix)) {
        return;
      }

      loadingDirectoriesRef.current.add(normalizedPrefix);
      setLoadingDirectories(new Set(loadingDirectoriesRef.current));
      if (normalizedPrefix === "") {
        setTreeRootLoading(true);
      }

      try {
        const result = await api.getTaskWorkspaceFiles(taskId, {
          executionId,
          prefix: normalizedPrefix || null,
          limit: 1000
        });

        setTreeEntryKindsByPath((current) => {
          const next = { ...current };
          for (const entry of result.entries) {
            next[entry.path] = entry.kind;
          }
          return next;
        });

        loadedDirectoriesRef.current.add(normalizedPrefix);
        setLoadedDirectories(new Set(loadedDirectoriesRef.current));

        if (result.truncated) {
          setTruncationNotice(`Directory ${result.prefix ?? "/"} was truncated to the first ${result.totalCount.toLocaleString()} items.`);
        }
      } catch (error) {
        setTreeError(error instanceof Error ? error.message : "Could not load workspace files.");
      } finally {
        loadingDirectoriesRef.current.delete(normalizedPrefix);
        setLoadingDirectories(new Set(loadingDirectoriesRef.current));
        if (normalizedPrefix === "") {
          setTreeRootLoading(false);
        }
      }
    },
    [executionId, taskId]
  );

  useEffect(() => {
    setExecutionId(null);
    setSelectedFilePath("");
    setSelectedLine(null);
    setFilterText("");
    setFileState({
      loading: false,
      preview: null,
      error: null
    });
    resetTreeState();
  }, [taskId, resetTreeState]);

  useEffect(() => {
    resetTreeState();
  }, [executionId, resetTreeState]);

  useEffect(() => {
    if (!openTarget || openTarget.taskId !== taskId) {
      return;
    }

    setExecutionId(openTarget.executionId ?? null);
    setSelectedFilePath(openTarget.filePath);
    setSelectedLine(openTarget.line);
    onOpenTargetHandled?.();
  }, [onOpenTargetHandled, openTarget, taskId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadDirectory("");
  }, [active, loadDirectory, refreshKey]);

  useEffect(() => {
    if (!active || !selectedFilePath) {
      return;
    }

    const parents = getParentDirectories(selectedFilePath);
    void (async () => {
      for (const directory of parents) {
        await loadDirectory(directory);
      }
      setExpandedDirectoryKeys((current) => {
        const merged = new Set(current);
        for (const parent of parents) {
          if (parent) {
            merged.add(parent);
          }
        }
        return Array.from(merged);
      });
    })();
  }, [active, loadDirectory, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath) {
      setFileState({
        loading: false,
        preview: null,
        error: null
      });
      return;
    }

    let cancelled = false;
    setFileState((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    void api
      .getTaskWorkspaceFile(taskId, selectedFilePath, { executionId })
      .then((preview) => {
        if (cancelled) {
          return;
        }
        setFileState({
          loading: false,
          preview,
          error: null
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setFileState({
          loading: false,
          preview: null,
          error: error instanceof Error ? error.message : "Could not open workspace file."
        });
      });

    return () => {
      cancelled = true;
    };
  }, [executionId, selectedFilePath, taskId]);

  useEffect(() => {
    if (!selectedLine || !fileState.preview || fileState.preview.kind !== "text") {
      return;
    }
    editorRef.current?.revealLineInCenter(selectedLine);
    editorRef.current?.setPosition({ lineNumber: selectedLine, column: 1 });
  }, [fileState.preview, selectedLine]);

  useEffect(() => {
    const filePaths = Object.entries(treeEntryKindsByPath)
      .filter(([, kind]) => kind === "file")
      .map(([path]) => path)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

    setSelectedFilePath((current) => {
      if (current && treeEntryKindsByPath[current] === "file") {
        return current;
      }
      return current || filePaths[0] || "";
    });
  }, [treeEntryKindsByPath]);

  const selectedLanguage = detectCodeLanguage(selectedFilePath || "");
  const treeData = useMemo(
    () => buildTreeData(treeEntryKindsByPath, filterText, loadingDirectories),
    [filterText, loadingDirectories, treeEntryKindsByPath]
  );

  const rootLoaded = loadedDirectories.has("");

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
          placeholder="Filter loaded files"
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

        {truncationNotice ? <Alert type="info" showIcon message={truncationNotice} /> : null}

        {treeError ? (
          <Alert type="error" showIcon message="Could not load files" description={treeError} />
        ) : treeRootLoading && !rootLoaded ? (
          <Flex justify="center" style={{ paddingTop: 32 }}>
            <Spin />
          </Flex>
        ) : rootLoaded && treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filterText.trim() ? "No loaded files match this filter" : "No files found"} />
        ) : (
          <Tree
            blockNode
            showLine
            height={560}
            expandedKeys={expandedDirectoryKeys}
            selectedKeys={selectedFilePath ? [selectedFilePath] : []}
            treeData={treeData}
            onExpand={(keys, info) => {
              const nextExpanded = (keys as Array<string | number>).map((key) => String(key));
              setExpandedDirectoryKeys(nextExpanded);
              if (info.expanded && !info.node.isLeaf) {
                void loadDirectory(String(info.node.key));
              }
            }}
            onSelect={(keys, info) => {
              const key = String(keys[0] ?? "");
              if (!key) {
                return;
              }
              if (!info.node.isLeaf) {
                setExpandedDirectoryKeys((current) => {
                  if (current.includes(key)) {
                    return current.filter((item) => item !== key);
                  }
                  return [...current, key];
                });
                void loadDirectory(key);
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
