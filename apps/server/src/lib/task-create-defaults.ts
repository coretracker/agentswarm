import type { AgentProvider, ProviderProfile, Repository, SystemSettings } from "@agentswarm/shared-types";
import { normalizeProvider } from "./provider-config.js";

type CreateTaskProviderDefaultsInput = {
  provider?: AgentProvider;
  providerProfile?: ProviderProfile;
  modelOverride?: string;
  model?: string | null;
};

export interface ResolvedCreateTaskProviderConfig {
  provider: AgentProvider;
  providerProfile: ProviderProfile;
  modelOverride: string | undefined;
}

const normalizeRepositoryDefaultModel = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
};

export const resolveCreateTaskProviderConfig = <T extends CreateTaskProviderDefaultsInput>(
  payload: T,
  settings: SystemSettings,
  repository?: Pick<Repository, "defaultProvider" | "defaultModel" | "defaultProviderProfile"> | null
): ResolvedCreateTaskProviderConfig => {
  const provider = normalizeProvider(payload.provider ?? repository?.defaultProvider ?? settings.defaultProvider);
  const providerProfile =
    payload.providerProfile ??
    repository?.defaultProviderProfile ??
    (provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort);
  const hasLegacyModel = Boolean(payload.model?.trim());
  const modelOverride =
    payload.modelOverride ??
    (hasLegacyModel
      ? undefined
      : normalizeRepositoryDefaultModel(repository?.defaultModel) ??
        (provider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel));

  return {
    provider,
    providerProfile,
    modelOverride
  };
};
