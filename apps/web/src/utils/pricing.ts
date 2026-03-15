/**
 * Estimated API pricing per million tokens (MTok) for known models.
 * Prices are approximate and may change — used for cost estimation only.
 * Source: OpenAI platform.openai.com/docs/pricing, Anthropic docs.anthropic.com/pricing (March 2026)
 */

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PRICING: Record<string, ModelPricing> = {
  // OpenAI — reasoning models
  "o3":          { inputPerMTok: 2.00,  outputPerMTok: 8.00  },
  "o3-mini":     { inputPerMTok: 1.10,  outputPerMTok: 4.40  },
  "o4-mini":     { inputPerMTok: 1.10,  outputPerMTok: 4.40  },
  "o3-pro":      { inputPerMTok: 20.00, outputPerMTok: 80.00 },

  // OpenAI — GPT-5 family
  "gpt-5":       { inputPerMTok: 1.25,  outputPerMTok: 10.00 },
  "gpt-5.4":     { inputPerMTok: 2.50,  outputPerMTok: 15.00 },
  "gpt-5-mini":  { inputPerMTok: 0.25,  outputPerMTok: 2.00  },

  // OpenAI — GPT-4.1 family
  "gpt-4.1":      { inputPerMTok: 2.00, outputPerMTok: 8.00  },
  "gpt-4.1-mini": { inputPerMTok: 0.40, outputPerMTok: 1.60  },
  "gpt-4.1-nano": { inputPerMTok: 0.10, outputPerMTok: 0.40  },

  // OpenAI — GPT-4o family
  "gpt-4o":       { inputPerMTok: 2.50, outputPerMTok: 10.00 },
  "gpt-4o-mini":  { inputPerMTok: 0.15, outputPerMTok: 0.60  },

  // Anthropic — Claude 4.6 (latest)
  "claude-opus-4-6":   { inputPerMTok: 5.00, outputPerMTok: 25.00 },
  "claude-sonnet-4-6": { inputPerMTok: 3.00, outputPerMTok: 15.00 },
  "claude-haiku-4-5":  { inputPerMTok: 1.00, outputPerMTok: 5.00  },

  // Anthropic — Claude 4.5 / 4
  "claude-opus-4-5":   { inputPerMTok: 5.00,  outputPerMTok: 25.00 },
  "claude-opus-4-1":   { inputPerMTok: 15.00, outputPerMTok: 75.00 },
  "claude-sonnet-4-5": { inputPerMTok: 3.00,  outputPerMTok: 15.00 },
  "claude-sonnet-4-0": { inputPerMTok: 3.00,  outputPerMTok: 15.00 },
  "claude-opus-4-0":   { inputPerMTok: 15.00, outputPerMTok: 75.00 },

  // Anthropic — Haiku 3.5 / 3
  "claude-haiku-3-5":  { inputPerMTok: 0.80, outputPerMTok: 4.00 },
  "claude-3-haiku":    { inputPerMTok: 0.25, outputPerMTok: 1.25 },
};

/** Resolve pricing for a model ID, trying prefix matches for aliased names. */
function resolvePricing(modelId: string): ModelPricing | null {
  const normalized = modelId.toLowerCase().trim();

  if (PRICING[normalized]) {
    return PRICING[normalized];
  }

  // Try prefix match (e.g. "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5")
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (normalized.startsWith(key)) {
      return pricing;
    }
  }

  return null;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
  isEstimate: true;
}

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): CostEstimate | null {
  const pricing = resolvePricing(modelId);
  if (!pricing) {
    return null;
  }

  const inputCost  = (inputTokens  / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: "USD",
    isEstimate: true
  };
}

export function formatCost(cost: number): string {
  if (cost < 0.001) {
    return `< $0.001`;
  }

  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }

  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }

  return `$${cost.toFixed(2)}`;
}
