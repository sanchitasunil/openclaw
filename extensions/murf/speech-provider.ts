import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { SpeechProviderConfig, SpeechProviderPlugin } from "openclaw/plugin-sdk/speech";
import { asObject, trimToUndefined } from "openclaw/plugin-sdk/speech";
import { murfTTS, normalizeMurfRegion } from "./tts.js";

const DEFAULT_MURF_VOICE_ID = "en-US-natalie";
const DEFAULT_MURF_MODEL = "FALCON";
const DEFAULT_MURF_LOCALE = "en-US";
const DEFAULT_MURF_STYLE = "Conversation";
const DEFAULT_MURF_REGION = "global";
const DEFAULT_MURF_FORMAT = "MP3";
const DEFAULT_MURF_SAMPLE_RATE = 24_000;
const DEFAULT_MURF_RATE = 0;
const DEFAULT_MURF_PITCH = 0;

const MURF_TTS_MODELS = ["FALCON", "GEN2"] as const;
const MURF_VALID_FORMATS = new Set(["MP3", "WAV", "OGG", "FLAC"]);

type MurfProviderConfig = {
  apiKey?: string;
  voiceId: string;
  model: string;
  locale: string;
  style: string;
  rate: number;
  pitch: number;
  region: string;
  format: string;
  sampleRate: number;
};

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeFormat(value: unknown): string | undefined {
  const trimmed = trimToUndefined(value)?.toUpperCase();
  return trimmed && MURF_VALID_FORMATS.has(trimmed) ? trimmed : undefined;
}

function normalizeMurfProviderConfig(rawConfig: Record<string, unknown>): MurfProviderConfig {
  const providers = asObject(rawConfig.providers);
  const raw = asObject(providers?.murf) ?? asObject(rawConfig.murf) ?? {};
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey,
      path: "messages.tts.providers.murf.apiKey",
    }),
    voiceId: trimToUndefined(raw.voiceId) ?? DEFAULT_MURF_VOICE_ID,
    model: trimToUndefined(raw.model) ?? DEFAULT_MURF_MODEL,
    locale: trimToUndefined(raw.locale) ?? DEFAULT_MURF_LOCALE,
    style: trimToUndefined(raw.style) ?? DEFAULT_MURF_STYLE,
    rate: asNumber(raw.rate) ?? DEFAULT_MURF_RATE,
    pitch: asNumber(raw.pitch) ?? DEFAULT_MURF_PITCH,
    region: normalizeMurfRegion(trimToUndefined(raw.region) ?? DEFAULT_MURF_REGION),
    format: normalizeFormat(raw.format) ?? DEFAULT_MURF_FORMAT,
    sampleRate: asNumber(raw.sampleRate) ?? DEFAULT_MURF_SAMPLE_RATE,
  };
}

function readMurfProviderConfig(config: SpeechProviderConfig): MurfProviderConfig {
  const defaults = normalizeMurfProviderConfig({});
  return {
    apiKey: trimToUndefined(config.apiKey) ?? defaults.apiKey,
    voiceId: trimToUndefined(config.voiceId) ?? defaults.voiceId,
    model: trimToUndefined(config.model) ?? defaults.model,
    locale: trimToUndefined(config.locale) ?? defaults.locale,
    style: trimToUndefined(config.style) ?? defaults.style,
    rate: asNumber(config.rate) ?? defaults.rate,
    pitch: asNumber(config.pitch) ?? defaults.pitch,
    region: normalizeMurfRegion(trimToUndefined(config.region) ?? defaults.region),
    format: normalizeFormat(config.format) ?? defaults.format,
    sampleRate: asNumber(config.sampleRate) ?? defaults.sampleRate,
  };
}

function formatToExtension(format: string): string {
  return `.${format.toLowerCase()}`;
}

export function buildMurfSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "murf",
    label: "Murf",
    autoSelectOrder: 30,
    models: MURF_TTS_MODELS,
    resolveConfig: ({ rawConfig }) => normalizeMurfProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) =>
      Boolean(readMurfProviderConfig(providerConfig).apiKey || process.env.MURF_API_KEY),
    synthesize: async (req) => {
      const config = readMurfProviderConfig(req.providerConfig);
      const overrides = req.providerOverrides ?? {};
      const apiKey = config.apiKey || process.env.MURF_API_KEY;
      if (!apiKey) {
        throw new Error("Murf API key missing");
      }

      // Telegram/WhatsApp voice bubbles expect Opus/OGG; fall back to OGG
      // so the audio is playable as a native voice note.
      const isVoiceNote = req.target === "voice-note";
      const requestedFormat = normalizeFormat(overrides.format) ?? config.format;
      const format = isVoiceNote ? "OGG" : requestedFormat;

      const audioBuffer = await murfTTS({
        text: req.text,
        apiKey,
        voiceId: trimToUndefined(overrides.voiceId) ?? config.voiceId,
        model: trimToUndefined(overrides.model) ?? config.model,
        locale: trimToUndefined(overrides.locale) ?? config.locale,
        style: trimToUndefined(overrides.style) ?? config.style,
        rate: asNumber(overrides.rate) ?? config.rate,
        pitch: asNumber(overrides.pitch) ?? config.pitch,
        region: normalizeMurfRegion(trimToUndefined(overrides.region) ?? config.region),
        format,
        sampleRate: asNumber(overrides.sampleRate) ?? config.sampleRate,
        timeoutMs: req.timeoutMs,
      });

      return {
        audioBuffer,
        outputFormat: format.toLowerCase(),
        fileExtension: formatToExtension(format),
        voiceCompatible: isVoiceNote,
      };
    },
  };
}
