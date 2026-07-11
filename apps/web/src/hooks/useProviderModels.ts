"use client";

import { useEffect, useState } from "react";
import type { AgentProvider, ProviderModelOption } from "@verft/shared-types";
import { getModelsForProvider } from "@verft/shared-types";
import { api } from "../api/client";

interface UseProviderModelsResult {
  models: ProviderModelOption[];
  loading: boolean;
  fromApi: boolean;
  source: "api" | "cache" | "fallback";
}

export function useProviderModels(provider: AgentProvider): UseProviderModelsResult {
  const [state, setState] = useState<{
    provider: AgentProvider;
    models: ProviderModelOption[];
    loading: boolean;
    fromApi: boolean;
    source: "api" | "cache" | "fallback";
  }>({
    provider,
    models: getModelsForProvider(provider),
    loading: true,
    fromApi: false,
    source: "fallback"
  });

  useEffect(() => {
    let active = true;
    setState({
      provider,
      models: getModelsForProvider(provider),
      loading: true,
      fromApi: false,
      source: "fallback"
    });

    void api.listModels(provider).then((response) => {
      if (!active) return;
      setState({
        provider,
        models: response.models.length > 0 ? response.models : getModelsForProvider(provider),
        loading: false,
        fromApi: response.source === "api",
        source: response.source
      });
    }).catch(() => {
      if (!active) return;
      setState({
        provider,
        models: getModelsForProvider(provider),
        loading: false,
        fromApi: false,
        source: "fallback"
      });
    });

    return () => {
      active = false;
    };
  }, [provider]);

  if (state.provider !== provider) {
    return { models: getModelsForProvider(provider), loading: true, fromApi: false, source: "fallback" };
  }

  return { models: state.models, loading: state.loading, fromApi: state.fromApi, source: state.source };
}
