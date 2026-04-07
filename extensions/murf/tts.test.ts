import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MURF_API_REGIONS,
  formatMurfErrorPayload,
  murfTTS,
  normalizeMurfRegion,
} from "./tts.ts";

function baseParams() {
  return {
    text: "hello",
    apiKey: "test-key",
    voiceId: "en-US-natalie",
    model: "FALCON",
    locale: "en-US",
    style: "Conversation",
    rate: 0,
    pitch: 0,
    region: "global",
    format: "MP3",
    sampleRate: 24_000,
    timeoutMs: 60_000,
  };
}

describe("murf tts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Region normalization ---

  it("exposes all documented regional host ids", () => {
    expect(MURF_API_REGIONS).toContain("eu-central");
    expect(MURF_API_REGIONS).toContain("us-west");
    expect(MURF_API_REGIONS).toHaveLength(12);
  });

  it("normalizeMurfRegion accepts regional ids and maps unknown to global", () => {
    expect(normalizeMurfRegion("us-west")).toBe("us-west");
    expect(normalizeMurfRegion("EU-CENTRAL")).toBe("eu-central");
    expect(normalizeMurfRegion("nope")).toBe("global");
    expect(normalizeMurfRegion(undefined)).toBe("global");
    expect(normalizeMurfRegion("")).toBe("global");
    expect(normalizeMurfRegion("  ")).toBe("global");
  });

  // --- Input validation ---

  it("rejects unsupported models before calling the network", async () => {
    await expect(murfTTS({ ...baseParams(), model: "GEN3" })).rejects.toThrow(
      'unsupported model "GEN3"',
    );
  });

  it("rejects empty text", async () => {
    await expect(murfTTS({ ...baseParams(), text: "" })).rejects.toThrow("text must not be empty");
  });

  it("rejects whitespace-only text", async () => {
    await expect(murfTTS({ ...baseParams(), text: "   \n\t  " })).rejects.toThrow(
      "text must not be empty",
    );
  });

  it("rejects text exceeding the character limit", async () => {
    await expect(murfTTS({ ...baseParams(), text: "a".repeat(5001) })).rejects.toThrow(
      "exceeds 5000 character limit",
    );
  });

  it("accepts text at exactly the character limit", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await murfTTS({ ...baseParams(), text: "a".repeat(5000) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects rate out of range", async () => {
    await expect(murfTTS({ ...baseParams(), rate: 51 })).rejects.toThrow(
      "rate must be between -50 and 50",
    );
    await expect(murfTTS({ ...baseParams(), rate: -51 })).rejects.toThrow(
      "rate must be between -50 and 50",
    );
  });

  it("rejects pitch out of range", async () => {
    await expect(murfTTS({ ...baseParams(), pitch: 51 })).rejects.toThrow(
      "pitch must be between -50 and 50",
    );
  });

  it("rejects unsupported format", async () => {
    await expect(murfTTS({ ...baseParams(), format: "AAC" })).rejects.toThrow(
      'unsupported format "AAC"',
    );
  });

  it("rejects unsupported sampleRate", async () => {
    await expect(murfTTS({ ...baseParams(), sampleRate: 22050 })).rejects.toThrow(
      "unsupported sampleRate 22050",
    );
  });

  // --- Request construction ---

  it("normalizes model casing in the JSON payload", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([9]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await murfTTS({ ...baseParams(), model: "falcon" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("FALCON");
  });

  it("constructs the correct regional URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await murfTTS({ ...baseParams(), region: "us-east" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    expect(call[0]).toBe("https://us-east.api.murf.ai/v1/speech/stream");
  });

  it("falls back to global region URL for unknown regions", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await murfTTS({ ...baseParams(), region: "unknown-region" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    expect(call[0]).toBe("https://global.api.murf.ai/v1/speech/stream");
  });

  it("sends api-key header", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await murfTTS({ ...baseParams(), apiKey: "my-secret-key" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock access
    const call = (fetchMock.mock.calls as any[])[0] as [string, RequestInit];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("my-secret-key");
  });

  // --- Error handling ---

  it("throws immediately on non-retryable API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("bad", { status: 400 }))),
    );

    await expect(murfTTS(baseParams())).rejects.toThrow("Murf TTS API error (400)");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses JSON error body with message and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message: "Invalid voice ID",
              code: "INVALID_VOICE",
            }),
            {
              status: 400,
              headers: { "x-request-id": "murf_req_123" },
            },
          ),
        ),
      ),
    );

    await expect(murfTTS(baseParams())).rejects.toThrow(
      "Murf TTS API error (400): Invalid voice ID [code=INVALID_VOICE] [request_id=murf_req_123]",
    );
  });

  it("parses nested detail.message in error body", async () => {
    // Use a non-retryable status (400) so we get immediate throw with JSON parsing.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: { message: "Rate limit exceeded", status: "rate_limited" },
            }),
            { status: 400 },
          ),
        ),
      ),
    );

    await expect(murfTTS(baseParams())).rejects.toThrow(
      "Murf TTS API error (400): Rate limit exceeded [code=rate_limited]",
    );
  });

  it("falls back to raw body text when error body is non-JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("service unavailable", { status: 400 }))),
    );

    await expect(murfTTS(baseParams())).rejects.toThrow(
      "Murf TTS API error (400): service unavailable",
    );
  });

  it("throws on empty audio response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array([]), { status: 200 }))),
    );

    await expect(murfTTS(baseParams())).rejects.toThrow("received empty audio response");
  });

  // --- Retry behavior ---

  it("retries on 503 then returns audio", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const synth = murfTTS(baseParams());

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    const buf = await synth;
    expect(buf.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const synth = murfTTS(baseParams());

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    const buf = await synth;
    expect(buf.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("formatMurfErrorPayload", () => {
  it("extracts message and code from flat object", () => {
    expect(formatMurfErrorPayload({ message: "Bad request", code: "ERR_BAD" })).toBe(
      "Bad request [code=ERR_BAD]",
    );
  });

  it("extracts message from nested detail object", () => {
    expect(
      formatMurfErrorPayload({ detail: { message: "Quota exceeded", status: "quota_exceeded" } }),
    ).toBe("Quota exceeded [code=quota_exceeded]");
  });

  it("extracts error field as fallback", () => {
    expect(formatMurfErrorPayload({ error: "Something went wrong" })).toBe(
      "Something went wrong",
    );
  });

  it("returns undefined for non-object input", () => {
    expect(formatMurfErrorPayload("string")).toBeUndefined();
    expect(formatMurfErrorPayload(null)).toBeUndefined();
    expect(formatMurfErrorPayload(undefined)).toBeUndefined();
  });

  it("returns undefined for object with no recognized fields", () => {
    expect(formatMurfErrorPayload({ foo: "bar" })).toBeUndefined();
  });
});
