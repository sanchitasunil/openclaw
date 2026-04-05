import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMurfSpeechProvider } from "./speech-provider.ts";

describe("murf speech provider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MURF_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns a valid SpeechProviderPlugin shape", () => {
    const provider = buildMurfSpeechProvider();
    expect(provider.id).toBe("murf");
    expect(provider.label).toBe("Murf");
    expect(provider.models).toContain("FALCON");
    expect(provider.models).toContain("GEN2");
    expect(typeof provider.isConfigured).toBe("function");
    expect(typeof provider.synthesize).toBe("function");
  });

  it("isConfigured returns true when MURF_API_KEY env var is set", () => {
    process.env.MURF_API_KEY = "test-key";
    const provider = buildMurfSpeechProvider();
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 10_000 })).toBe(true);
  });

  it("isConfigured returns true when apiKey is in providerConfig", () => {
    const provider = buildMurfSpeechProvider();
    expect(
      provider.isConfigured({ providerConfig: { apiKey: "config-key" }, timeoutMs: 10_000 }),
    ).toBe(true);
  });

  it("isConfigured returns false when no key is available", () => {
    const provider = buildMurfSpeechProvider();
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 10_000 })).toBe(false);
  });

  it("synthesize throws when no API key is available", async () => {
    const provider = buildMurfSpeechProvider();
    await expect(
      provider.synthesize({
        text: "Hello",
        cfg: {} as Parameters<typeof provider.synthesize>[0]["cfg"],
        providerConfig: {},
        target: "audio-file",
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("Murf API key missing");
  });

  it("resolveConfig normalizes raw config with defaults", () => {
    const provider = buildMurfSpeechProvider();
    const resolved = provider.resolveConfig?.({
      cfg: {} as Parameters<NonNullable<typeof provider.resolveConfig>>[0]["cfg"],
      rawConfig: { murf: { voiceId: "Matthew" } },
      timeoutMs: 10_000,
    });
    expect(resolved).toMatchObject({
      voiceId: "Matthew",
      model: "FALCON",
      locale: "en-US",
      format: "MP3",
      sampleRate: 24_000,
    });
  });
});
