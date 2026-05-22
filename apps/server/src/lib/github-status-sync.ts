const SYNC_NOTE_REGEX = /<!--\s*agentswarm:github_sync_status_enabled=(true|false)\s*-->/gi;

const toSyncMarker = (enabled: boolean): string => `<!-- agentswarm:github_sync_status_enabled=${enabled ? "true" : "false"} -->`;

export const withGitHubStatusSyncMarker = (notes: string | null | undefined, enabled: boolean): string => {
  const base = typeof notes === "string" ? notes.replace(SYNC_NOTE_REGEX, "").trim() : "";
  const marker = toSyncMarker(enabled);
  if (!base) {
    return marker;
  }
  return `${base}\n${marker}`;
};

export const getGitHubStatusSyncFromNotes = (notes: string | null | undefined): boolean | null => {
  if (typeof notes !== "string" || notes.trim().length === 0) {
    return null;
  }

  let match: RegExpExecArray | null = null;
  let parsed: boolean | null = null;
  const pattern = new RegExp(SYNC_NOTE_REGEX);
  while ((match = pattern.exec(notes)) !== null) {
    parsed = match[1] === "true";
  }
  return parsed;
};
