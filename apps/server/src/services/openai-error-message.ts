export function formatOpenAiErrorMessage(status: number, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return `OpenAI request failed (${status})`;
  }
  if (/^\s*</.test(trimmed)) {
    return `OpenAI request failed (${status}). Upstream returned an HTML error page.`;
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // Keep text responses, but never leak full upstream pages.
  }
  return trimmed.slice(0, 2000);
}
