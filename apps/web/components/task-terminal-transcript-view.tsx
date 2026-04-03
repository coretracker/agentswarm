"use client";

import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export interface TaskTerminalTranscriptViewProps {
  content: string;
  height?: number;
}

export function TaskTerminalTranscriptView({
  content,
  height = 280
}: TaskTerminalTranscriptViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const terminal = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 10_000,
      theme: {
        background: "#0b0f14",
        foreground: "#d8e1ee"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* ignore temporary zero-sized layouts */
      }
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.reset();
    terminal.options.disableStdin = true;
    try {
      fitAddon.fit();
    } catch {
      /* ignore temporary zero-sized layouts */
    }
    terminal.write(content, () => {
      terminal.scrollToBottom();
      try {
        fitAddon.fit();
      } catch {
        /* ignore temporary zero-sized layouts */
      }
    });
  }, [content]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        minHeight: height,
        borderRadius: 8,
        overflow: "hidden",
        background: "#0b0f14"
      }}
    />
  );
}
