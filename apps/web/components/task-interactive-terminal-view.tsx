"use client";

import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const FONT_SIZE_STORAGE_KEY = "agentswarm-interactive-terminal-font-size";
const FONT_MIN = 10;
const FONT_MAX = 28;

/** Default xterm font size (px) when no session zoom is stored. */
export const DEFAULT_INTERACTIVE_TERMINAL_FONT_SIZE = 14;

function readStoredFontSize(fallback: number): number {
  if (typeof sessionStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = sessionStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
  } catch {
    return fallback;
  }
}

export interface TaskInteractiveTerminalViewProps {
  taskId: string;
  /** Initial / reset font size (px) before any session zoom. Default 14. */
  defaultFontSize?: number;
}

/**
 * One browser tab/window == one WebSocket == one `docker run` with the task workspace at /workspace.
 */
export function TaskInteractiveTerminalView({
  taskId,
  defaultFontSize = DEFAULT_INTERACTIVE_TERMINAL_FONT_SIZE
}: TaskInteractiveTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const baseFont = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(defaultFontSize)));
    const initialFont = readStoredFontSize(baseFont);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: initialFont,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4"
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    term.writeln("\x1b[90mConnecting…\x1b[0m");

    const wsUrl = `${apiBaseUrl.replace(/^http/, "ws")}/tasks/${encodeURIComponent(taskId)}/interactive-terminal`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    const sendResize = (): void => {
      try {
        fitAddon.fit();
      } catch {
        /* container may have zero size briefly */
      }
      if (ws.readyState === WebSocket.OPEN && term.cols > 0 && term.rows > 0) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const scheduleLayout = (): void => {
      requestAnimationFrame(() => {
        requestAnimationFrame(sendResize);
      });
    };

    const applyFontSize = (next: number): void => {
      const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next)));
      term.options.fontSize = clamped;
      try {
        sessionStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clamped));
      } catch {
        /* private mode / quota */
      }
      scheduleLayout();
    };

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return true;
      }
      if (e.altKey) {
        return true;
      }

      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        applyFontSize((term.options.fontSize ?? baseFont) - 1);
        return false;
      }
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        applyFontSize((term.options.fontSize ?? baseFont) + 1);
        return false;
      }
      if (e.code === "Digit0") {
        term.options.fontSize = baseFont;
        try {
          sessionStorage.removeItem(FONT_SIZE_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        scheduleLayout();
        return false;
      }

      return true;
    });

    const onOpen = (): void => {
      term.reset();
      scheduleLayout();
      term.focus();
    };

    const onMessage = (ev: MessageEvent): void => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new TextDecoder().decode(ev.data));
        return;
      }
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; message?: string };
          if (msg.type === "error") {
            term.writeln(`\r\n\x1b[31m${msg.message ?? "Error"}\x1b[0m`);
          }
        } catch {
          /* ignore */
        }
      }
    };

    const onWsError = (): void => {
      term.writeln("\r\n\x1b[31mWebSocket error (check login, CODEX_INTERACTIVE_IMAGE, and workspace).\x1b[0m");
    };

    const onWsClose = (): void => {
      term.writeln("\r\n\x1b[33m[disconnected]\x1b[0m");
    };

    const endBrowserSession = (): void => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "page closed");
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onWsError);
    ws.addEventListener("close", onWsClose);

    const onData = (data: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    };
    term.onData(onData);

    const ro = new ResizeObserver(scheduleLayout);
    ro.observe(el);
    window.addEventListener("pagehide", endBrowserSession);
    window.addEventListener("beforeunload", endBrowserSession);

    return () => {
      ro.disconnect();
      window.removeEventListener("pagehide", endBrowserSession);
      window.removeEventListener("beforeunload", endBrowserSession);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onWsError);
      ws.removeEventListener("close", onWsClose);
      try {
        ws.close(1000, "unmount");
      } catch {
        /* ignore */
      }
      term.dispose();
    };
  }, [taskId, defaultFontSize]);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        width: "100%",
        minHeight: 0
      }}
    />
  );
}
