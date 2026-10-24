import { OpenAIProvider } from './providers/openai.js';
import { MockProvider } from './providers/mock.js';

export const PROVIDERS = {
  openai: OpenAIProvider,
  mock: MockProvider
};

/**
 * Register a custom provider class
 * @param {string} name
 * @param {typeof import('./providers/base.js').BaseProvider} providerClass
 */
export function registerProvider(name, providerClass) {
  PROVIDERS[name.toLowerCase()] = providerClass;
}

/**
 * Create provider instance based on name and config
 * @param {string} providerName
 * @param {object} config
 * @returns {import('./providers/base.js').BaseProvider}
 */
export function createProvider(providerName, config = {}) {
  const normalized = (providerName || 'openai').toLowerCase();
  const ProviderClass = PROVIDERS[normalized];

  if (!ProviderClass) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown provider "${providerName}". Available providers: ${available}.`);
  }

  return new ProviderClass(config);
}
