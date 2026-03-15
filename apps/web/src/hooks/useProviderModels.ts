"use client";

import { useEffect, useState } from "react";
import type { AgentProvider, ProviderModelOption } from "@agentswarm/shared-types";
import { getModelsForProvider } from "@agentswarm/shared-types";
import { api } from "../api/client";

interface UseProviderModelsResult {
  models: ProviderModelOption[];
  loading: boolean;
  fromApi: boolean;
}

export function useProviderModels(provider: AgentProvider): UseProviderModelsResult {
  const [models, setModels] = useState<ProviderModelOption[]>(getModelsForProvider(provider));
  const [loading, setLoading] = useState(true);
  const [fromApi, setFromApi] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setModels(getModelsForProvider(provider));
    setFromApi(false);

    void api.listModels(provider).then((response) => {
      if (!active) return;
      setModels(response.models.length > 0 ? response.models : getModelsForProvider(provider));
      setFromApi(response.source === "api");
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setModels(getModelsForProvider(provider));
      setFromApi(false);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [provider]);

  return { models, loading, fromApi };
}
