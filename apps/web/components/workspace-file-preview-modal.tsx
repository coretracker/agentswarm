"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Alert, Modal, Space, Spin, Tag, Typography } from "antd";

export interface WorkspaceFileLinkTarget {
  taskId: string;
  filePath: string;
  line: number | null;
}

export interface WorkspaceFilePreviewModalProps {
  open: boolean;
  loading: boolean;
  filePath: string;
  content: string;
  line: number | null;
  error: string | null;
  onCancel: () => void;
}

type HighlightTokenKind = "plain" | "comment" | "keyword" | "number" | "string";

interface HighlightToken {
  kind: HighlightTokenKind;
  text: string;
}

interface LanguageConfig {
  label: string;
  lineCommentPrefixes: string[];
  stringDelimiters: string[];
  keywords: Set<string>;
}

const workspaceFileLinkPathRe = /^\/task-workspaces\/([^/]+)\/(.+)$/;

const tokenStyles: Record<HighlightTokenKind, CSSProperties> = {
  plain: { color: "#1f1f1f" },
  comment: { color: "#8c8c8c", fontStyle: "italic" },
  keyword: { color: "#0958d9", fontWeight: 600 },
  number: { color: "#d46b08" },
  string: { color: "#389e0d" }
};

const defaultLanguageConfig: LanguageConfig = {
  label: "Text",
  lineCommentPrefixes: [],
  stringDelimiters: ['"', "'"],
  keywords: new Set<string>()
};

const typeScriptKeywords = [
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "while",
  "yield"
] as const;

const javaScriptKeywords = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "while",
  "yield"
] as const;

const languageConfigs: Record<string, LanguageConfig> = {
  swift: {
    label: "Swift",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "actor",
      "any",
      "as",
      "async",
      "associatedtype",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "continue",
      "default",
      "defer",
      "deinit",
      "do",
      "else",
      "enum",
      "extension",
      "false",
      "fileprivate",
      "for",
      "func",
      "guard",
      "if",
      "import",
      "in",
      "init",
      "internal",
      "is",
      "let",
      "nil",
      "open",
      "private",
      "protocol",
      "public",
      "repeat",
      "return",
      "self",
      "some",
      "static",
      "struct",
      "subscript",
      "super",
      "switch",
      "throw",
      "throws",
      "true",
      "try",
      "typealias",
      "var",
      "where",
      "while"
    ])
  },
  ts: {
    label: "TypeScript",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set(typeScriptKeywords)
  },
  tsx: {
    label: "TSX",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set(typeScriptKeywords)
  },
  js: {
    label: "JavaScript",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set(javaScriptKeywords)
  },
  jsx: {
    label: "JSX",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set(javaScriptKeywords)
  },
  json: {
    label: "JSON",
    lineCommentPrefixes: [],
    stringDelimiters: ['"'],
    keywords: new Set(["false", "null", "true"])
  },
  py: {
    label: "Python",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "and",
      "as",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "elif",
      "else",
      "False",
      "finally",
      "for",
      "from",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "None",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "True",
      "try",
      "while",
      "with",
      "yield"
    ])
  },
  rb: {
    label: "Ruby",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "begin",
      "break",
      "case",
      "class",
      "def",
      "do",
      "else",
      "elsif",
      "end",
      "ensure",
      "false",
      "for",
      "if",
      "in",
      "module",
      "next",
      "nil",
      "redo",
      "rescue",
      "retry",
      "return",
      "self",
      "super",
      "then",
      "true",
      "unless",
      "until",
      "when",
      "while",
      "yield"
    ])
  },
  java: {
    label: "Java",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "abstract",
      "boolean",
      "break",
      "case",
      "catch",
      "class",
      "continue",
      "default",
      "do",
      "else",
      "enum",
      "extends",
      "false",
      "final",
      "finally",
      "for",
      "if",
      "implements",
      "import",
      "instanceof",
      "interface",
      "new",
      "null",
      "package",
      "private",
      "protected",
      "public",
      "return",
      "static",
      "super",
      "switch",
      "this",
      "throw",
      "throws",
      "true",
      "try",
      "void",
      "while"
    ])
  },
  kt: {
    label: "Kotlin",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "as",
      "break",
      "class",
      "companion",
      "continue",
      "data",
      "do",
      "else",
      "false",
      "for",
      "fun",
      "if",
      "in",
      "interface",
      "is",
      "null",
      "object",
      "override",
      "package",
      "private",
      "protected",
      "public",
      "return",
      "sealed",
      "super",
      "suspend",
      "this",
      "throw",
      "true",
      "try",
      "typealias",
      "val",
      "var",
      "when",
      "while"
    ])
  },
  go: {
    label: "Go",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set([
      "break",
      "case",
      "chan",
      "const",
      "continue",
      "default",
      "defer",
      "else",
      "fallthrough",
      "false",
      "for",
      "func",
      "go",
      "if",
      "import",
      "interface",
      "map",
      "package",
      "range",
      "return",
      "select",
      "struct",
      "switch",
      "true",
      "type",
      "var"
    ])
  },
  rs: {
    label: "Rust",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'"],
    keywords: new Set([
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "crate",
      "else",
      "enum",
      "extern",
      "false",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "mod",
      "move",
      "mut",
      "pub",
      "ref",
      "return",
      "self",
      "static",
      "struct",
      "super",
      "trait",
      "true",
      "type",
      "unsafe",
      "use",
      "where",
      "while"
    ])
  },
  css: {
    label: "CSS",
    lineCommentPrefixes: [],
    stringDelimiters: ['"', "'"],
    keywords: new Set(["@import", "@media", "@supports", "important"])
  },
  scss: {
    label: "SCSS",
    lineCommentPrefixes: ["//"],
    stringDelimiters: ['"', "'"],
    keywords: new Set(["@if", "@else", "@each", "@for", "@include", "@mixin", "@use", "@forward"])
  },
  html: {
    label: "HTML",
    lineCommentPrefixes: ["<!--"],
    stringDelimiters: ['"', "'"],
    keywords: new Set(["doctype"])
  },
  xml: {
    label: "XML",
    lineCommentPrefixes: ["<!--"],
    stringDelimiters: ['"', "'"],
    keywords: new Set<string>()
  },
  yml: {
    label: "YAML",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'"],
    keywords: new Set(["false", "no", "null", "off", "on", "true", "yes"])
  },
  yaml: {
    label: "YAML",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'"],
    keywords: new Set(["false", "no", "null", "off", "on", "true", "yes"])
  },
  sh: {
    label: "Shell",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set([
      "case",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "export",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "local",
      "readonly",
      "return",
      "then",
      "until",
      "while"
    ])
  },
  bash: {
    label: "Shell",
    lineCommentPrefixes: ["#"],
    stringDelimiters: ['"', "'", "`"],
    keywords: new Set([
      "case",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "export",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "local",
      "readonly",
      "return",
      "then",
      "until",
      "while"
    ])
  },
  md: {
    label: "Markdown",
    lineCommentPrefixes: [],
    stringDelimiters: ['"', "'"],
    keywords: new Set<string>()
  }
};

const languageByExtension: Array<[string, string]> = [
  [".tsx", "tsx"],
  [".ts", "ts"],
  [".jsx", "jsx"],
  [".js", "js"],
  [".swift", "swift"],
  [".json", "json"],
  [".py", "py"],
  [".rb", "rb"],
  [".java", "java"],
  [".kt", "kt"],
  [".go", "go"],
  [".rs", "rs"],
  [".scss", "scss"],
  [".css", "css"],
  [".html", "html"],
  [".xml", "xml"],
  [".yaml", "yaml"],
  [".yml", "yml"],
  [".bash", "bash"],
  [".sh", "sh"],
  [".md", "md"]
];

function detectCodeLanguage(filePath: string): string {
  const normalized = filePath.trim().toLowerCase();
  for (const [extension, language] of languageByExtension) {
    if (normalized.endsWith(extension)) {
      return language;
    }
  }
  return "text";
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$@]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$@]/.test(char);
}

function isNumberStart(line: string, index: number): boolean {
  const char = line[index];
  if (!char || !/[0-9]/.test(char)) {
    return false;
  }

  const previous = index > 0 ? line[index - 1] : "";
  return !previous || !/[A-Za-z0-9_]/.test(previous);
}

function parseStringToken(line: string, start: number, delimiter: string): { text: string; end: number } {
  let end = start + 1;

  while (end < line.length) {
    const current = line[end];
    if (current === "\\") {
      end += 2;
      continue;
    }
    if (current === delimiter) {
      end += 1;
      break;
    }
    end += 1;
  }

  return {
    text: line.slice(start, Math.min(end, line.length)),
    end: Math.min(end, line.length)
  };
}

function compactHighlightTokens(tokens: HighlightToken[]): HighlightToken[] {
  if (tokens.length === 0) {
    return tokens;
  }

  const compacted: HighlightToken[] = [tokens[0]!];
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = compacted[compacted.length - 1]!;
    const current = tokens[index]!;
    if (previous.kind === current.kind) {
      previous.text += current.text;
      continue;
    }
    compacted.push(current);
  }
  return compacted;
}

function tokenizeLine(line: string, language: string): HighlightToken[] {
  const config = languageConfigs[language] ?? defaultLanguageConfig;
  const tokens: HighlightToken[] = [];
  let index = 0;

  while (index < line.length) {
    const commentPrefix = config.lineCommentPrefixes.find((prefix) => line.startsWith(prefix, index));
    if (commentPrefix) {
      tokens.push({ kind: "comment", text: line.slice(index) });
      break;
    }

    const char = line[index]!;

    if (config.stringDelimiters.includes(char)) {
      const stringToken = parseStringToken(line, index, char);
      tokens.push({ kind: "string", text: stringToken.text });
      index = stringToken.end;
      continue;
    }

    if (isNumberStart(line, index)) {
      let end = index + 1;
      while (end < line.length && /[0-9A-Fa-f_xob.]/.test(line[end]!)) {
        end += 1;
      }
      tokens.push({ kind: "number", text: line.slice(index, end) });
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end]!)) {
        end += 1;
      }

      const text = line.slice(index, end);
      tokens.push({ kind: config.keywords.has(text) ? "keyword" : "plain", text });
      index = end;
      continue;
    }

    tokens.push({ kind: "plain", text: char });
    index += 1;
  }

  return compactHighlightTokens(tokens);
}

function renderHighlightedLine(line: string, language: string): ReactNode {
  const tokens = tokenizeLine(line, language);
  if (tokens.length === 0) {
    return " ";
  }

  return tokens.map((token, index) => (
    <span key={`${token.kind}-${index}`} style={tokenStyles[token.kind]}>
      {token.text}
    </span>
  ));
}

export function parseWorkspaceFileLink(href?: string): WorkspaceFileLinkTarget | null {
  if (!href?.trim()) {
    return null;
  }

  try {
    const url = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const match = workspaceFileLinkPathRe.exec(url.pathname);
    if (!match) {
      return null;
    }

    const lineMatch = /^#L(\d+)(?:[-:].*)?$/.exec(url.hash);
    return {
      taskId: match[1] ?? "",
      filePath: decodeURIComponent(match[2] ?? ""),
      line: lineMatch ? Number.parseInt(lineMatch[1]!, 10) : null
    };
  } catch {
    return null;
  }
}

export function WorkspaceFilePreviewModal({
  open,
  loading,
  filePath,
  content,
  line,
  error,
  onCancel
}: WorkspaceFilePreviewModalProps) {
  const language = useMemo(() => detectCodeLanguage(filePath), [filePath]);
  const languageLabel = (languageConfigs[language] ?? defaultLanguageConfig).label;
  const lines = useMemo(() => (content.length > 0 ? content.split(/\r?\n/) : [""]), [content]);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !line || !contentRef.current) {
      return;
    }

    const target = contentRef.current.querySelector<HTMLElement>(`[data-line="${line}"]`);
    target?.scrollIntoView({ block: "center" });
  }, [content, line, open]);

  const gutterWidth = Math.max(56, String(lines.length || 1).length * 10 + 24);

  return (
    <Modal
      open={open}
      title={
        <Space wrap size={8}>
          <Typography.Text code>{filePath || "Workspace file"}</Typography.Text>
          <Tag>{languageLabel}</Tag>
          {line ? <Tag color="blue">Line {line}</Tag> : null}
        </Space>
      }
      width={1100}
      footer={null}
      destroyOnClose
      onCancel={onCancel}
      styles={{ body: { paddingTop: 12 } }}
    >
      {loading ? (
        <div style={{ paddingBlock: 40, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message="Could not open workspace file" description={error} />
      ) : (
        <div
          ref={contentRef}
          style={{
            maxHeight: "70vh",
            overflow: "auto",
            border: "1px solid #f0f0f0",
            borderRadius: 10,
            background: "#fafafa"
          }}
        >
          <div
            style={{
              minWidth: "100%",
              fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.65
            }}
          >
            {lines.map((lineText, index) => {
              const lineNumber = index + 1;
              const selected = lineNumber === line;
              return (
                <div
                  key={`${lineNumber}-${lineText.length}`}
                  data-line={lineNumber}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `${gutterWidth}px minmax(0, 1fr)`,
                    alignItems: "stretch",
                    background: selected ? "rgba(22, 119, 255, 0.08)" : lineNumber % 2 === 0 ? "rgba(0, 0, 0, 0.015)" : "transparent",
                    borderInlineStart: selected ? "3px solid #1677ff" : "3px solid transparent"
                  }}
                >
                  <div
                    style={{
                      padding: "0 12px 0 8px",
                      textAlign: "right",
                      userSelect: "none",
                      color: selected ? "#1677ff" : "#8c8c8c",
                      borderRight: "1px solid #f0f0f0",
                      background: selected ? "rgba(22, 119, 255, 0.06)" : "rgba(0, 0, 0, 0.02)"
                    }}
                  >
                    {lineNumber}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "0 16px",
                      whiteSpace: "pre",
                      overflow: "visible"
                    }}
                  >
                    {renderHighlightedLine(lineText, language)}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
