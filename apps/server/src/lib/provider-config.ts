import type { AgentProvider, ProviderProfile, TaskReasoningEffort } from "@agentswarm/shared-types";

export const DEFAULT_PROVIDER: AgentProvider = "codex";
export const DEFAULT_PROVIDER_PROFILE: ProviderProfile = "deep";

export const normalizeProvider = (value: string | undefined | null): AgentProvider =>
  value === "claude" ? "claude" : "codex";

export const normalizeProviderProfile = (
  profile: ProviderProfile | undefined | null,
  legacyReasoningEffort?: TaskReasoningEffort | null
): ProviderProfile => {
  if (
    profile === "quick" ||
    profile === "balanced" ||
    profile === "deep" ||
    profile === "super_deep" ||
    profile === "unlimited"
  ) {
    return profile;
  }

  switch (legacyReasoningEffort) {
    case "minimal":
    case "low":
      return "quick";
    case "medium":
      return "balanced";
    case "high":
    case "xhigh":
      return "deep";
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
    return profile === "quick" || profile === "balanced" ? "sonnet" : "opus";
  }

  return "gpt-5.4";
};

export const codexReasoningEffortForProfile = (profile: ProviderProfile): TaskReasoningEffort =>
  ({
    quick: "low",
    balanced: "medium",
    deep: "xhigh",
    super_deep: "xhigh",
    unlimited: "xhigh"
  } as const)[profile];

export const claudeMaxTurnsForProfile = (profile: ProviderProfile): number | undefined =>
  ({
    quick: 8,
    balanced: 16,
    deep: 32,
    super_deep: 48,
    unlimited: undefined
  })[profile];
