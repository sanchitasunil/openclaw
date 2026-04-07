/**
 * Live integration tests for the Murf TTS provider.
 *
 * Gated behind the MURF_API_KEY environment variable — skipped entirely
 * when the key is not set. Run with:
 *
 *   MURF_API_KEY=your_key npx vitest run extensions/murf/murf.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { murfTTS } from "./tts.ts";
import { buildMurfSpeechProvider, listMurfVoices } from "./speech-provider.ts";

const MURF_API_KEY = process.env.MURF_API_KEY ?? "";
const liveEnabled = MURF_API_KEY.trim().length > 0;
const describeLive = liveEnabled ? describe : describe.skip;

describeLive("murf live integration", () => {
  it("synthesizes audio via the real Murf API", async () => {
    const buffer = await murfTTS({
      text: "Hello from OpenClaw integration test.",
      apiKey: MURF_API_KEY,
      voiceId: "en-US-natalie",
      model: "FALCON",
      locale: "en-US",
      style: "Conversation",
      rate: 0,
      pitch: 0,
      region: "global",
      format: "MP3",
      sampleRate: 24_000,
      timeoutMs: 30_000,
    });

    // Should return non-empty audio data.
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("lists voices via the real Murf API", async () => {
    const voices = await listMurfVoices({ apiKey: MURF_API_KEY });

    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
    // Every voice should have a non-empty id.
    for (const voice of voices) {
      expect(voice.id.length).toBeGreaterThan(0);
    }
  });

  it("synthesizes via the provider plugin interface", async () => {
    const provider = buildMurfSpeechProvider();
    const result = await provider.synthesize({
      text: "Provider integration test.",
      cfg: {} as Parameters<typeof provider.synthesize>[0]["cfg"],
      providerConfig: { apiKey: MURF_API_KEY },
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.length).toBeGreaterThan(100);
    expect(result.outputFormat).toBe("mp3");
    expect(result.fileExtension).toBe(".mp3");
  });

  it("returns a clear error for invalid API key", async () => {
    await expect(
      murfTTS({
        text: "This should fail.",
        apiKey: "invalid-key-12345",
        voiceId: "en-US-natalie",
        model: "FALCON",
        locale: "en-US",
        style: "Conversation",
        rate: 0,
        pitch: 0,
        region: "global",
        format: "MP3",
        sampleRate: 24_000,
        timeoutMs: 15_000,
      }),
    ).rejects.toThrow("Murf TTS API error");
  });
}, 60_000);
