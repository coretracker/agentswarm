import type { AgentProvider, ProviderProfile, TaskReasoningEffort } from "@agentswarm/shared-types";

export const DEFAULT_PROVIDER: AgentProvider = "codex";
export const DEFAULT_PROVIDER_PROFILE: ProviderProfile = "high";

export const normalizeProvider = (value: string | undefined | null): AgentProvider =>
  value === "claude" ? "claude" : "codex";

export const normalizeProviderProfile = (
  profile: ProviderProfile | string | undefined | null,
  legacyReasoningEffort?: TaskReasoningEffort | null
): ProviderProfile => {
  if (profile === "low" || profile === "medium" || profile === "high" || profile === "max") {
    return profile;
  }

  // Map old custom profile names to native values
  switch (profile) {
    case "quick":
      return "low";
    case "balanced":
      return "medium";
    case "deep":
    case "super_deep":
    case "unlimited":
      return "high";
  }

  // Map legacy reasoningEffort field to native values
  switch (legacyReasoningEffort) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return DEFAULT_PROVIDER_PROFILE;
  }
};

export const normalizeModelOverride = (
  modelOverride: string | undefined | null,
  legacyModel?: string | null
): string | null => {
  const normalized = modelOverride?.trim() || legacyModel?.trim() || "";
  return normalized || null;
};

export const defaultModelForProvider = (provider: AgentProvider, profile: ProviderProfile): string | null => {
  if (provider === "claude") {
    return profile === "low" || profile === "medium" ? "claude-sonnet-4-5" : "claude-opus-4-5";
  }

  return "gpt-5.4";
};

/** Codex CLI accepts "low", "medium", "high" natively; "max" is not supported — fall back to "high". */
export const codexReasoningEffortForProfile = (profile: ProviderProfile): string =>
  profile === "max" ? "high" : profile;

export const claudeModelSupportsThinkingBudget = (model: string | null | undefined): boolean => {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  return (
    normalized === "claude-opus-4" ||
    normalized.startsWith("claude-opus-4-") ||
    normalized === "claude-sonnet-4" ||
    normalized.startsWith("claude-sonnet-4-") ||
    normalized === "claude-3-7-sonnet" ||
    normalized.startsWith("claude-3-7-sonnet-") ||
    normalized === "claude-sonnet-3-7" ||
    normalized.startsWith("claude-sonnet-3-7-")
  );
};

/** Claude Code exposes reasoning via thinking budgets; "max" means leave the budget unset. */
export const claudeThinkingBudgetTokensForProfile = (profile: ProviderProfile): number | undefined =>
  ({
    low: 1024,
    medium: 4096,
    high: 16384,
    max: undefined
  })[profile];
