export const HARNESS_EDITOR_OPTIONS = {
  accessibilitySupport: "off",
  automaticLayout: true,
  codeLens: false,
  colorDecorators: false,
  contextmenu: false,
  cursorBlinking: "solid",
  folding: false,
  glyphMargin: false,
  hover: { enabled: false },
  lightbulb: { enabled: "off" as editor.ShowLightbulbIconMode },
  lineDecorationsWidth: 0,
  lineNumbers: "off",
  lineNumbersMinChars: 0,
  links: false,
  matchBrackets: "never",
  minimap: { enabled: false },
  occurrencesHighlight: "off",
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  parameterHints: { enabled: false },
  quickSuggestions: false,
  renderLineHighlight: "none",
  selectionHighlight: false,
  showFoldingControls: "never",
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: "off",
  wordWrap: "on"
} as const;

export const normalizeHarnessMarkdown = (value: string | null | undefined): string => value ?? "";
import type { editor } from "monaco-editor";
