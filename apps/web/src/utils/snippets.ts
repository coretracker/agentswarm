export const insertSnippetContent = (current: string | null | undefined, snippet: string | null | undefined): string => {
  const snippetText = snippet?.trim() ?? "";
  if (!snippetText) {
    return current ?? "";
  }

  const currentText = current ?? "";
  if (currentText.trim().length === 0) {
    return snippetText;
  }

  return `${currentText.trimEnd()}\n\n${snippetText}`;
};
