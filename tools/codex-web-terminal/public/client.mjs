import { Terminal } from "/assets/xterm/lib/xterm.mjs";
import { FitAddon } from "/assets/addon-fit/lib/addon-fit.mjs";

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${location.host}/ws`;

const term = new Terminal({
  cursorBlink: true,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: "#1e1e1e",
    foreground: "#cccccc",
  },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

const container = document.getElementById("terminal");
term.open(container);
term.writeln("\x1b[90mConnecting to session…\x1b[0m");

function sendResize(ws) {
  try {
    fitAddon.fit();
  } catch {
    /* fit() can throw if the container is hidden or too small */
  }
  if (ws.readyState === WebSocket.OPEN && term.cols > 0 && term.rows > 0) {
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }
}

function scheduleLayout(ws) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sendResize(ws);
    });
  });
}

const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

ws.addEventListener("open", () => {
  term.reset();
  scheduleLayout(ws);
  term.focus();
});

ws.addEventListener("message", (ev) => {
  if (ev.data instanceof ArrayBuffer) {
    term.write(new TextDecoder().decode(ev.data));
    return;
  }
  if (typeof ev.data === "string") {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "error") {
        term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
      }
    } catch {
      /* ignore */
    }
  }
});

term.onData((data) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(new TextEncoder().encode(data));
  }
});

ws.addEventListener("error", () => {
  term.writeln("\r\n\x1b[31mWebSocket error (is the server running?)\x1b[0m");
});

ws.addEventListener("close", () => {
  term.writeln("\r\n\x1b[33m[connection closed]\x1b[0m");
});

const ro = new ResizeObserver(() => {
  scheduleLayout(ws);
});
ro.observe(container);

window.addEventListener("load", () => {
  scheduleLayout(ws);
});

/** Close the WebSocket when the tab or window goes away so the server tears down `docker run`. */
function endBrowserSession() {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(1000, "page closed");
  }
}
window.addEventListener("pagehide", endBrowserSession);
window.addEventListener("beforeunload", endBrowserSession);
