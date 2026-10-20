// Hermes's live model catalogue as the shared model picker shows it, free of the DOM and of React. It reads the body of Hermes's
// model options (`GET /api/model/options`, or the gateway's `model.options`, which has the same shape). Nothing here is stored:
// the catalogue is asked for again when the picker opens or the owner presses Refresh (D1: Hermes is the source of truth).

/** One provider/model pair, as Hermes's model set takes it. */
export interface ModelChoice {
  provider: string;
  model: string;
}

export interface ModelBadge {
  id: 'reasoning' | 'fast' | 'free' | 'locked';
  label: string;
}

export interface CatalogueModel {
  id: string;
  badges: ModelBadge[];
  /** Hermes's price for a million tokens, as it words it ("$3.00"), when it knows one. */
  price: { input: string; output: string } | undefined;
}

/**
 * - `ready`: the provider has a credential and Hermes listed its models;
 * - `needs-setup`: Hermes knows the provider but this profile has no credential for it;
 * - `no-models`: Hermes has the provider but listed nothing, so it may be unreachable;
 * - `saved-list`: the models are the list saved in the profile's config for an endpoint of the owner's own, which Hermes did not check live.
 */
export type ProviderState = 'ready' | 'needs-setup' | 'no-models' | 'saved-list';

export interface CatalogueProvider {
  slug: string;
  name: string;
  isCurrent: boolean;
  state: ProviderState;
  /** What to tell the owner about this provider, when there is something: Hermes's own warning, or what its state means. */
  note: string | undefined;
  models: CatalogueModel[];
  /** How many more models Hermes has for the provider than it listed (0 when it listed all of them). */
  unlisted: number;
}

export interface Catalogue {
  /** What the profile uses now, as Hermes says. Empty strings when nothing is set. */
  current: ModelChoice;
  providers: CatalogueProvider[];
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads the body of Hermes's model options. Hermes declares no schema for it, so it is read defensively. */
export function parseCatalogue(payload: unknown): Catalogue {
  const body = record(payload);
  const providers = (Array.isArray(body.providers) ? body.providers : []).flatMap((item): CatalogueProvider[] => {
    const row = record(item);
    const slug = text(row.slug);
    if (slug === '') return [];
    const ids = (Array.isArray(row.models) ? row.models : []).filter((id): id is string => typeof id === 'string');
    const capabilities = record(row.capabilities);
    const pricing = record(row.pricing);
    const locked = new Set(Array.isArray(row.unavailable_models) ? row.unavailable_models : []);
    const models = ids.map((id): CatalogueModel => {
      const caps = record(capabilities[id]);
      const price = record(pricing[id]);
      const badges: ModelBadge[] = [];
      if (caps.reasoning === true) badges.push({ id: 'reasoning', label: 'Reasoning' });
      if (caps.fast === true) badges.push({ id: 'fast', label: 'Fast mode' });
      if (price.free === true) badges.push({ id: 'free', label: 'Free' });
      if (locked.has(id)) badges.push({ id: 'locked', label: 'Not in your plan' });
      return {
        id,
        badges,
        price: typeof price.input === 'string' && price.input !== '' ? { input: price.input, output: text(price.output) } : undefined,
      };
    });
    const warning = text(row.warning) || undefined;
    const unlisted = typeof row.total_models === 'number' ? Math.max(0, row.total_models - models.length) : 0;
    let state: ProviderState = 'ready';
    let note = warning;
    if (row.authenticated === false) state = 'needs-setup';
    else if (models.length === 0) {
      state = 'no-models';
      note ??= 'Hermes listed no models for this provider. It may be unreachable; Refresh asks again.';
    } else if (row.is_user_defined === true && row.source === 'user-config') {
      state = 'saved-list';
      note ??= 'The models are the list saved in this profile’s config. Hermes did not check them live, so the list may be out of date.';
    }
    return [{ slug, name: text(row.name) || slug, isCurrent: row.is_current === true, state, note, models, unlisted }];
  });
  return { current: { provider: text(body.provider), model: text(body.model) }, providers };
}

/**
 * The providers and models that match a search: every word has to appear in the model id, or in the provider's name or slug.
 * A provider that matches by itself keeps all its models. Providers without a match are left out.
 */
export function searchCatalogue(catalogue: Catalogue, query: string): CatalogueProvider[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return catalogue.providers;
  return catalogue.providers.flatMap((provider) => {
    const owner = `${provider.name} ${provider.slug}`.toLowerCase();
    const models = provider.models.filter((model) => words.every((word) => `${owner} ${model.id.toLowerCase()}`.includes(word)));
    const providerMatches = words.every((word) => owner.includes(word));
    if (providerMatches) return [provider];
    return models.length > 0 ? [{ ...provider, models }] : [];
  });
}

/**
 * The provider to ask Hermes for a recommended default when the profile has no model: the first one the profile has a credential
 * for and Hermes listed models for. Mixture-of-Agents is a virtual provider, never a recommendation.
 */
export function recommendedProvider(catalogue: Catalogue): string | undefined {
  return catalogue.providers.find((provider) => provider.state === 'ready' && provider.slug !== 'moa')?.slug;
}
