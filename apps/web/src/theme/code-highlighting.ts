import type { CSSProperties } from "react";
import type { PrismTheme } from "prism-react-renderer";
import { themes } from "prism-react-renderer";
import type { GlobalToken } from "antd/es/theme/interface";
import { isDarkAppTheme, type AppThemeMode } from "./antd-theme";

type HighlightTokenKind = "plain" | "comment" | "keyword" | "number" | "string";

type TokenStyleMap = Record<HighlightTokenKind, CSSProperties>;

function createPrismThemeFromToken(baseTheme: PrismTheme, token: GlobalToken, darkMode: boolean): PrismTheme {
  const keywordColor = darkMode ? token.colorPrimaryText : token.colorPrimary;
  const stringColor = darkMode ? token.colorSuccessText : token.colorSuccess;
  const commentColor = token.colorTextTertiary;
  const numberColor = darkMode ? token.colorWarningText : token.colorWarning;

  return {
    ...baseTheme,
    plain: {
      ...(baseTheme.plain ?? {}),
      color: token.colorText,
      backgroundColor: token.colorBgContainer
    },
    styles: [
      ...(baseTheme.styles ?? []),
      { types: ["comment", "prolog", "doctype", "cdata"], style: { color: commentColor, fontStyle: "italic" } },
      { types: ["keyword", "selector", "inserted"], style: { color: keywordColor, fontWeight: 600 } },
      { types: ["string", "char", "attr-value"], style: { color: stringColor } },
      { types: ["number", "boolean", "constant"], style: { color: numberColor } }
    ]
  };
}

export function getPrismTheme(mode: AppThemeMode, token: GlobalToken): PrismTheme {
  const darkMode = isDarkAppTheme(mode);
  const baseTheme = darkMode ? themes.vsDark : themes.github;
  return createPrismThemeFromToken(baseTheme, token, darkMode);
}

export function getCodeTokenStyles(token: GlobalToken): TokenStyleMap {
  return {
    plain: { color: token.colorText },
    comment: { color: token.colorTextTertiary, fontStyle: "italic" },
    keyword: { color: token.colorPrimaryText, fontWeight: 600 },
    number: { color: token.colorWarningText },
    string: { color: token.colorSuccessText }
  };
}
