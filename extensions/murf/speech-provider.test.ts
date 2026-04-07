import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechModelOverridePolicy } from "openclaw/plugin-sdk/speech";
import { buildMurfSpeechProvider, listMurfVoices } from "./speech-provider.ts";

/** Shorthand for the cfg parameter (opaque to the provider). */
type AnyCfg = Parameters<ReturnType<typeof buildMurfSpeechProvider>["synthesize"]>[0]["cfg"];
const EMPTY_CFG = {} as AnyCfg;

/** Full-permission policy for directive token tests. */
const ALLOW_ALL_POLICY: SpeechModelOverridePolicy = {
  enabled: true,
  allowText: true,
  allowProvider: true,
  allowVoice: true,
  allowModelId: true,
  allowVoiceSettings: true,
  allowNormalization: true,
  allowSeed: true,
};

describe("murf speech provider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MURF_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // --- Shape ---

  it("returns a valid SpeechProviderPlugin shape", () => {
    const provider = buildMurfSpeechProvider();
    expect(provider.id).toBe("murf");
    expect(provider.label).toBe("Murf");
    expect(provider.models).toContain("FALCON");
    expect(provider.models).toContain("GEN2");
    expect(typeof provider.isConfigured).toBe("function");
    expect(typeof provider.synthesize).toBe("function");
    expect(typeof provider.listVoices).toBe("function");
    expect(typeof provider.parseDirectiveToken).toBe("function");
    expect(typeof provider.resolveTalkConfig).toBe("function");
    expect(typeof provider.resolveTalkOverrides).toBe("function");
  });

  // --- isConfigured ---

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

  // --- resolveConfig ---

  it("resolveConfig normalizes raw config with defaults", () => {
    const provider = buildMurfSpeechProvider();
    const resolved = provider.resolveConfig?.({
      cfg: EMPTY_CFG,
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

  it("resolveConfig reads nested providers.murf", () => {
    const provider = buildMurfSpeechProvider();
    const resolved = provider.resolveConfig?.({
      cfg: EMPTY_CFG,
      rawConfig: { providers: { murf: { voiceId: "Matthew", model: "gen2" } } },
      timeoutMs: 10_000,
    });
    expect(resolved).toMatchObject({
      voiceId: "Matthew",
      model: "GEN2",
      sampleRate: 44_100,
    });
  });

  it("resolveConfig coerces numeric strings for sampleRate", () => {
    const provider = buildMurfSpeechProvider();
    const resolved = provider.resolveConfig?.({
      cfg: EMPTY_CFG,
      rawConfig: { murf: { sampleRate: "48000" } },
      timeoutMs: 10_000,
    });
    expect(resolved?.sampleRate).toBe(48_000);
  });

  // --- synthesize ---

  it("synthesize throws when no API key is available", async () => {
    const provider = buildMurfSpeechProvider();
    await expect(
      provider.synthesize({
        text: "Hello",
        cfg: EMPTY_CFG,
        providerConfig: {},
        target: "audio-file",
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("Murf API key missing");
  });

  it("synthesize requests OGG for voice-note targets", async () => {
    process.env.MURF_API_KEY = "test-key";
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = buildMurfSpeechProvider();
    const result = await provider.synthesize({
      text: "Hi",
      cfg: EMPTY_CFG,
      providerConfig: { format: "MP3" },
      target: "voice-note",
      timeoutMs: 10_000,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.format).toBe("OGG");
    expect(result.voiceCompatible).toBe(true);
    expect(result.fileExtension).toBe(".ogg");
  });

  it("synthesize returns correct format metadata for audio-file target", async () => {
    process.env.MURF_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 }))),
    );

    const provider = buildMurfSpeechProvider();
    const result = await provider.synthesize({
      text: "Hi",
      cfg: EMPTY_CFG,
      providerConfig: { format: "WAV" },
      target: "audio-file",
      timeoutMs: 10_000,
    });

    expect(result.outputFormat).toBe("wav");
    expect(result.fileExtension).toBe(".wav");
    expect(result.voiceCompatible).toBe(false);
  });

  it("synthesize applies providerOverrides", async () => {
    process.env.MURF_API_KEY = "test-key";
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = buildMurfSpeechProvider();
    await provider.synthesize({
      text: "Hi",
      cfg: EMPTY_CFG,
      providerConfig: { voiceId: "en-US-natalie", model: "FALCON" },
      providerOverrides: { voiceId: "en-US-jackson", model: "GEN2" },
      target: "audio-file",
      timeoutMs: 10_000,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.voiceId).toBe("en-US-jackson");
    expect(body.model).toBe("GEN2");
  });

  // --- listVoices ---

  it("listVoices throws when no API key is available", async () => {
    const provider = buildMurfSpeechProvider();
    await expect(
      provider.listVoices!({ providerConfig: {} }),
    ).rejects.toThrow("Murf API key missing");
  });

  it("listVoices returns parsed voice entries", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            voices: [
              { voiceId: "en-US-natalie", name: "Natalie", locale: "en-US", gender: "Female" },
              { voiceId: "en-US-jackson", name: "Jackson", locale: "en-US", gender: "Male" },
              { voiceId: "", name: "Bad" }, // should be filtered out
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const voices = await listMurfVoices({ apiKey: "test-key" });
    expect(voices).toHaveLength(2);
    expect(voices[0]).toMatchObject({ id: "en-US-natalie", name: "Natalie", gender: "Female" });
    expect(voices[1]).toMatchObject({ id: "en-US-jackson", name: "Jackson" });
  });

  it("listVoices throws on API error with actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("Forbidden", { status: 403 }))),
    );

    await expect(listMurfVoices({ apiKey: "bad-key" })).rejects.toThrow(
      "Murf voices API error (403)",
    );
  });

  // --- parseDirectiveToken ---

  it("parseDirectiveToken handles voiceid key", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "voiceid",
      value: "en-US-jackson",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toMatchObject({ voiceId: "en-US-jackson" });
  });

  it("parseDirectiveToken handles murf_voice alias", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "murf_voice",
      value: "en-UK-harry",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toMatchObject({ voiceId: "en-UK-harry" });
  });

  it("parseDirectiveToken handles model key", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "model",
      value: "GEN2",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toMatchObject({ model: "GEN2" });
  });

  it("parseDirectiveToken handles rate with validation", () => {
    const provider = buildMurfSpeechProvider();
    const ok = provider.parseDirectiveToken!({
      key: "rate",
      value: "25",
      policy: ALLOW_ALL_POLICY,
    });
    expect(ok.handled).toBe(true);
    expect(ok.overrides).toMatchObject({ rate: 25 });

    const bad = provider.parseDirectiveToken!({
      key: "rate",
      value: "999",
      policy: ALLOW_ALL_POLICY,
    });
    expect(bad.handled).toBe(true);
    expect(bad.warnings).toBeDefined();
    expect(bad.overrides).toBeUndefined();
  });

  it("parseDirectiveToken handles pitch with validation", () => {
    const provider = buildMurfSpeechProvider();
    const ok = provider.parseDirectiveToken!({
      key: "pitch",
      value: "-10",
      policy: ALLOW_ALL_POLICY,
    });
    expect(ok.handled).toBe(true);
    expect(ok.overrides).toMatchObject({ pitch: -10 });
  });

  it("parseDirectiveToken handles style", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "style",
      value: "Newscast",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toMatchObject({ style: "Newscast" });
  });

  it("parseDirectiveToken handles format with validation", () => {
    const provider = buildMurfSpeechProvider();
    const ok = provider.parseDirectiveToken!({
      key: "format",
      value: "wav",
      policy: ALLOW_ALL_POLICY,
    });
    expect(ok.handled).toBe(true);
    expect(ok.overrides).toMatchObject({ format: "WAV" });

    const bad = provider.parseDirectiveToken!({
      key: "format",
      value: "aac",
      policy: ALLOW_ALL_POLICY,
    });
    expect(bad.handled).toBe(true);
    expect(bad.warnings).toBeDefined();
  });

  it("parseDirectiveToken handles locale", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "locale",
      value: "es-ES",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toMatchObject({ locale: "es-ES" });
  });

  it("parseDirectiveToken respects policy restrictions", () => {
    const provider = buildMurfSpeechProvider();
    const deniedPolicy: SpeechModelOverridePolicy = {
      ...ALLOW_ALL_POLICY,
      allowVoice: false,
    };
    const result = provider.parseDirectiveToken!({
      key: "voiceid",
      value: "en-US-jackson",
      policy: deniedPolicy,
    });
    expect(result.handled).toBe(true);
    expect(result.overrides).toBeUndefined();
  });

  it("parseDirectiveToken returns unhandled for unknown keys", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.parseDirectiveToken!({
      key: "unknown_key",
      value: "anything",
      policy: ALLOW_ALL_POLICY,
    });
    expect(result.handled).toBe(false);
  });

  // --- resolveTalkConfig ---

  it("resolveTalkConfig merges talk provider config over base", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.resolveTalkConfig!({
      cfg: EMPTY_CFG,
      baseTtsConfig: { murf: { voiceId: "en-US-natalie", model: "FALCON" } },
      talkProviderConfig: { voiceId: "en-US-jackson", style: "Newscast" },
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({
      voiceId: "en-US-jackson",
      style: "Newscast",
      model: "FALCON",
    });
  });

  it("resolveTalkConfig preserves base when talk config has no overrides", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.resolveTalkConfig!({
      cfg: EMPTY_CFG,
      baseTtsConfig: { murf: { voiceId: "en-US-natalie", model: "GEN2" } },
      talkProviderConfig: {},
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({
      voiceId: "en-US-natalie",
      model: "GEN2",
    });
  });

  // --- resolveTalkOverrides ---

  it("resolveTalkOverrides extracts supported params", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.resolveTalkOverrides!({
      talkProviderConfig: {},
      params: {
        voiceId: "en-US-jackson",
        model: "gen2",
        style: "Newscast",
        rate: 10,
        pitch: -5,
        format: "wav",
      },
    });
    expect(result).toMatchObject({
      voiceId: "en-US-jackson",
      model: "GEN2",
      style: "Newscast",
      rate: 10,
      pitch: -5,
      format: "WAV",
    });
  });

  it("resolveTalkOverrides returns empty object for no matching params", () => {
    const provider = buildMurfSpeechProvider();
    const result = provider.resolveTalkOverrides!({
      talkProviderConfig: {},
      params: { unknownParam: "value" },
    });
    expect(result).toEqual({});
  });
});
