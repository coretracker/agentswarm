const endpoint = process.env.VERFT_MCP_ENDPOINT?.trim();
const endpoints = (process.env.VERFT_MCP_ENDPOINTS?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);
const token = process.env.VERFT_MCP_TOKEN?.trim();
const requestTimeoutMs = 10_000;
const endpointCandidates = endpoints.length > 0 ? endpoints : endpoint ? [endpoint] : [];

if (endpointCandidates.length === 0) {
  console.error("[verft-mcp] VERFT_MCP_ENDPOINT or VERFT_MCP_ENDPOINTS is required");
  process.exit(1);
}

if (!token) {
  console.error("[verft-mcp] VERFT_MCP_TOKEN is required");
  process.exit(1);
}

let buffer = Buffer.alloc(0);

const encodeFrame = (message) => {
  return `${JSON.stringify(message)}\n`;
};

const findHeaderEnd = (input) => {
  const crlf = input.indexOf("\r\n\r\n");
  if (crlf >= 0) {
    return { index: crlf, length: 4 };
  }
  const lf = input.indexOf("\n\n");
  if (lf >= 0) {
    return { index: lf, length: 2 };
  }
  return null;
};

const parseContentLength = (headers) => {
  for (const line of headers.split(/\r?\n/)) {
    const match = /^Content-Length:\s*(\d+)\s*$/i.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
};

const readMessages = () => {
  const messages = [];

  while (buffer.byteLength > 0) {
    const asText = buffer.toString("utf8");
    if (asText.startsWith("Content-Length:")) {
      const headerEnd = findHeaderEnd(asText);
      if (!headerEnd) {
        break;
      }

      const contentLength = parseContentLength(asText.slice(0, headerEnd.index));
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        throw new Error("Invalid MCP frame: missing Content-Length");
      }

      const bodyStart = Buffer.byteLength(asText.slice(0, headerEnd.index + headerEnd.length), "utf8");
      const frameLength = bodyStart + contentLength;
      if (buffer.byteLength < frameLength) {
        break;
      }

      const body = buffer.subarray(bodyStart, frameLength).toString("utf8");
      buffer = buffer.subarray(frameLength);
      messages.push(JSON.parse(body));
      continue;
    }

    const newline = buffer.indexOf(0x0a);
    if (newline < 0) {
      break;
    }

    const line = buffer.subarray(0, newline).toString("utf8").trim();
    buffer = buffer.subarray(newline + 1);
    if (line) {
      messages.push(JSON.parse(line));
    }
  }

  return messages;
};

const toErrorResponse = (id, message) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: {
    code: -32000,
    message
  }
});

const requestEndpoint = async (candidateEndpoint, message) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const response = await fetch(candidateEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    signal: controller.signal,
    body: JSON.stringify(message)
  }).finally(() => clearTimeout(timeout));

  const raw = await response.text();
  if (!raw.trim()) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = toErrorResponse(message?.id, `Verft MCP returned non-JSON response (${response.status})`);
  }

  process.stdout.write(encodeFrame(parsed));
};

const forwardMessage = async (message) => {
  const failures = [];
  for (const candidateEndpoint of endpointCandidates) {
    try {
      await requestEndpoint(candidateEndpoint, message);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      failures.push(`${candidateEndpoint}: ${message}`);
    }
  }
  throw new Error(`Verft MCP bridge request failed (${failures.join("; ")})`);
};

const handleMessage = async (message) => {
  try {
    await forwardMessage(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "request failed";
    console.error(`[verft-mcp] ${errorMessage}`);
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      process.stdout.write(encodeFrame(toErrorResponse(message.id, errorMessage)));
    }
  }
};

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let messages;
  try {
    messages = readMessages();
  } catch (error) {
    console.error(`[verft-mcp] ${error instanceof Error ? error.message : "invalid input"}`);
    buffer = Buffer.alloc(0);
    return;
  }

  for (const message of messages) {
    void handleMessage(message);
  }
});

process.stdin.resume();
