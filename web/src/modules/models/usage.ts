// Hermes's per-model usage as Agents › Models › Usage shows it, free of the DOM and of React. It reads Hermes's model analytics
// (`GET /api/analytics/models`); nothing is kept or summed here (D1).
import type { ModelInfoBadge } from './model-settings.ts';

export type UsageDays = 7 | 30 | 90;
export const USAGE_PERIODS: readonly UsageDays[] = [7, 30, 90];

export const usagePath = (profile: string, days: UsageDays) => `/api/analytics/models?profile=${encodeURIComponent(profile)}&days=${days}`;

export interface UsageCost {
  usd: number;
  /** `billed`: what the provider charged. `estimated`: Hermes's own estimate from its price table, marked as one on the card. */
  kind: 'billed' | 'estimated';
}

export interface UsageCard {
  model: string;
  provider: string;
  requests: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  /** `undefined` when Hermes gave no cost for the model (a local model, or a provider it has no prices for). */
  cost: UsageCost | undefined;
  /** The context window models.dev gives the model, in tokens; 0 when Hermes does not know it. */
  contextWindow: number;
  maxOutput: number;
  badges: ModelInfoBadge[];
}

export interface Usage {
  days: number;
  cards: UsageCard[];
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** Reads Hermes's answer: a card for each model, in Hermes's order (most tokens first). */
export function parseUsage(payload: unknown): Usage {
  const body = record(payload);
  const cards = (Array.isArray(body.models) ? body.models : []).flatMap((item): UsageCard[] => {
    const row = record(item);
    const model = text(row.model);
    if (model === '') return [];
    const capabilities = record(row.capabilities);
    const badges: ModelInfoBadge[] = [];
    if (capabilities.supports_tools === true) badges.push({ id: 'tools', label: 'Tools' });
    if (capabilities.supports_vision === true) badges.push({ id: 'vision', label: 'Vision' });
    if (capabilities.supports_reasoning === true) badges.push({ id: 'reasoning', label: 'Reasoning' });
    const billed = count(row.actual_cost);
    const estimated = count(row.estimated_cost);
    return [
      {
        model,
        provider: text(row.provider),
        requests: count(row.api_calls),
        sessions: count(row.sessions),
        inputTokens: count(row.input_tokens),
        outputTokens: count(row.output_tokens),
        cost: billed > 0 ? { usd: billed, kind: 'billed' } : estimated > 0 ? { usd: estimated, kind: 'estimated' } : undefined,
        contextWindow: count(capabilities.context_window),
        maxOutput: count(capabilities.max_output_tokens),
        badges,
      },
    ];
  });
  return { days: count(body.period_days), cards };
}
