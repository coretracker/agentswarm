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
  const [state, setState] = useState<{
    provider: AgentProvider;
    models: ProviderModelOption[];
    loading: boolean;
    fromApi: boolean;
  }>({
    provider,
    models: getModelsForProvider(provider),
    loading: true,
    fromApi: false
  });

  useEffect(() => {
    let active = true;
    setState({
      provider,
      models: getModelsForProvider(provider),
      loading: true,
      fromApi: false
    });

    void api.listModels(provider).then((response) => {
      if (!active) return;
      setState({
        provider,
        models: response.models.length > 0 ? response.models : getModelsForProvider(provider),
        loading: false,
        fromApi: response.source === "api"
      });
    }).catch(() => {
      if (!active) return;
      setState({
        provider,
        models: getModelsForProvider(provider),
        loading: false,
        fromApi: false
      });
    });

    return () => {
      active = false;
    };
  }, [provider]);

  if (state.provider !== provider) {
    return { models: getModelsForProvider(provider), loading: true, fromApi: false };
  }

  return { models: state.models, loading: state.loading, fromApi: state.fromApi };
}
