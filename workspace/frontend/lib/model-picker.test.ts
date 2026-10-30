import { describe, it, expect } from 'vitest';
import { curatedModelsFitEndpoint, hostOf } from './model-picker';

const providers = [
  { name: 'openai', base_url: null },
  { name: 'anthropic', base_url: null },
  { name: 'google', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
];

describe('hostOf', () => {
  it('keeps only the lowercased hostname', () => {
    expect(hostOf('https://user:secret@Relay.Example.com:8443/v1')).toBe('relay.example.com');
  });

  it('reads a URL written without a scheme', () => {
    expect(hostOf('api.deepseek.com/v1')).toBe('api.deepseek.com');
  });

  it('is null for nothing', () => {
    expect(hostOf('')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});

describe('curatedModelsFitEndpoint', () => {
  it('keeps the list when the node reports no endpoint', () => {
    expect(curatedModelsFitEndpoint({ baseUrlHost: null, modelsProvider: 'openai', providers })).toBe(true);
    expect(curatedModelsFitEndpoint({ baseUrlHost: undefined, modelsProvider: null, providers })).toBe(true);
  });

  it('drops the list for a relay', () => {
    expect(
      curatedModelsFitEndpoint({ baseUrlHost: 'relay.example.com', modelsProvider: 'openai', providers }),
    ).toBe(false);
  });

  it("keeps it for the provider's own endpoint", () => {
    expect(
      curatedModelsFitEndpoint({
        baseUrlHost: 'generativelanguage.googleapis.com',
        modelsProvider: 'google',
        providers,
      }),
    ).toBe(true);
  });

  it('knows the SDK default host of a provider with no base_url', () => {
    expect(curatedModelsFitEndpoint({ baseUrlHost: 'api.openai.com', modelsProvider: 'openai', providers })).toBe(true);
  });

  it("drops it when another vendor's endpoint drives the agent", () => {
    // A saved Anthropic key on an OpenAI-protocol agent is sent to api.anthropic.com.
    expect(
      curatedModelsFitEndpoint({ baseUrlHost: 'api.anthropic.com', modelsProvider: 'openai', providers }),
    ).toBe(false);
  });

  it('drops a vendor-curated list once any endpoint is set', () => {
    expect(curatedModelsFitEndpoint({ baseUrlHost: 'api.moonshot.cn', modelsProvider: null, providers })).toBe(false);
  });
});
