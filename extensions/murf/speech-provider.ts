import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderPlugin,
  SpeechVoiceOption,
} from "openclaw/plugin-sdk/speech";
import { asObject, requireInRange, trimToUndefined } from "openclaw/plugin-sdk/speech";
import { murfTTS, normalizeMurfRegion } from "./tts.js";

const DEFAULT_MURF_VOICE_ID = "en-US-natalie";
const DEFAULT_MURF_MODEL = "FALCON";
const DEFAULT_MURF_LOCALE = "en-US";
const DEFAULT_MURF_STYLE = "Conversation";
const DEFAULT_MURF_REGION = "global";
const DEFAULT_MURF_FORMAT = "MP3";
const DEFAULT_MURF_RATE = 0;
const DEFAULT_MURF_PITCH = 0;

const MURF_TTS_MODELS = ["FALCON", "GEN2"] as const;
const MURF_TTS_MODEL_SET = new Set<string>(MURF_TTS_MODELS);
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) {
      return undefined;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Murf defaults: 24 kHz (Falcon) vs 44.1 kHz (Gen2) per API schema notes. */
function defaultMurfSampleRateForModel(model: string): number {
  return model === "GEN2" ? 44_100 : 24_000;
}

function normalizeMurfModelField(raw: unknown): string {
  const v = trimToUndefined(raw);
  if (v === undefined) {
    return DEFAULT_MURF_MODEL;
  }
  const t = v.trim();
  const upper = t.toUpperCase();
  return MURF_TTS_MODEL_SET.has(upper) ? upper : t;
}

function normalizeFormat(value: unknown): string | undefined {
  const trimmed = trimToUndefined(value)?.toUpperCase();
  return trimmed && MURF_VALID_FORMATS.has(trimmed) ? trimmed : undefined;
}

function normalizeMurfProviderConfig(rawConfig: Record<string, unknown>): MurfProviderConfig {
  const providers = asObject(rawConfig.providers);
  const raw = asObject(providers?.murf) ?? asObject(rawConfig.murf) ?? {};
  const model = normalizeMurfModelField(raw.model);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey,
      path: "messages.tts.providers.murf.apiKey",
    }),
    voiceId: trimToUndefined(raw.voiceId) ?? DEFAULT_MURF_VOICE_ID,
    model,
    locale: trimToUndefined(raw.locale) ?? DEFAULT_MURF_LOCALE,
    style: trimToUndefined(raw.style) ?? DEFAULT_MURF_STYLE,
    rate: asNumber(raw.rate) ?? DEFAULT_MURF_RATE,
    pitch: asNumber(raw.pitch) ?? DEFAULT_MURF_PITCH,
    region: normalizeMurfRegion(trimToUndefined(raw.region) ?? DEFAULT_MURF_REGION),
    format: normalizeFormat(raw.format) ?? DEFAULT_MURF_FORMAT,
    sampleRate: asNumber(raw.sampleRate) ?? defaultMurfSampleRateForModel(model),
  };
}

function readMurfProviderConfig(config: SpeechProviderConfig): MurfProviderConfig {
  const defaults = normalizeMurfProviderConfig({});
  const model = normalizeMurfModelField(config.model ?? defaults.model);
  return {
    apiKey: trimToUndefined(config.apiKey) ?? defaults.apiKey,
    voiceId: trimToUndefined(config.voiceId) ?? defaults.voiceId,
    model,
    locale: trimToUndefined(config.locale) ?? defaults.locale,
    style: trimToUndefined(config.style) ?? defaults.style,
    rate: asNumber(config.rate) ?? defaults.rate,
    pitch: asNumber(config.pitch) ?? defaults.pitch,
    region: normalizeMurfRegion(trimToUndefined(config.region) ?? defaults.region),
    format: normalizeFormat(config.format) ?? defaults.format,
    sampleRate: asNumber(config.sampleRate) ?? defaultMurfSampleRateForModel(model),
  };
}

function formatToExtension(format: string): string {
  return `.${format.toLowerCase()}`;
}

/** Base URL for non-regional Murf API endpoints (e.g. voice listing). */
const MURF_API_BASE_URL = "https://api.murf.ai";

/**
 * Fetch available voices from the Murf API.
 *
 * Uses the non-regional base URL (`api.murf.ai`) because the voices catalog
 * endpoint is not region-scoped. Returns a normalized list of
 * {@link SpeechVoiceOption} entries suitable for the `listVoices` provider hook.
 */
export async function listMurfVoices(params: {
  apiKey: string;
  model?: string;
}): Promise<SpeechVoiceOption[]> {
  const url = new URL(`${MURF_API_BASE_URL}/v1/speech/voices`);
  if (params.model) {
    url.searchParams.set("model", params.model);
  }
  const res = await fetch(url.toString(), {
    headers: { "api-key": params.apiKey },
  });
  if (!res.ok) {
    throw new Error(
      `Murf voices API error (${res.status}): unable to list voices. ` +
        "Check that your API key is valid and has the required permissions.",
    );
  }
  // The Murf API returns an array of voice objects directly (or wrapped in
  // a `voices` field depending on version). Handle both shapes defensively.
  const json = await res.json();
  const voiceArray: Array<Record<string, unknown>> = Array.isArray(json)
    ? json
    : Array.isArray((json as Record<string, unknown>).voices)
      ? ((json as Record<string, unknown>).voices as Array<Record<string, unknown>>)
      : [];
  return voiceArray
    .map((v) => ({
      id: (typeof v.voiceId === "string" ? v.voiceId.trim() : "") as string,
      name:
        (typeof v.displayName === "string" ? v.displayName.trim() : undefined) ||
        (typeof v.name === "string" ? v.name.trim() : undefined) ||
        undefined,
      locale: (typeof v.locale === "string" ? v.locale.trim() : undefined) || undefined,
      gender: (typeof v.gender === "string" ? v.gender.trim() : undefined) || undefined,
      description:
        (typeof v.description === "string" ? v.description.trim() : undefined) || undefined,
    }))
    .filter((v) => v.id.length > 0);
}

function parseNumberValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse Murf-specific directive tokens from in-message TTS overrides.
 * Mirrors ElevenLabs' `parseDirectiveToken` pattern — checks policy flags
 * before applying each override.
 */
function parseMurfDirectiveToken(ctx: SpeechDirectiveTokenParseContext) {
  try {
    switch (ctx.key) {
      case "voiceid":
      case "voice_id":
      case "murf_voice":
      case "murfvoice":
        if (!ctx.policy.allowVoice) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), voiceId: ctx.value },
        };
      case "model":
      case "modelid":
      case "model_id":
      case "murf_model":
      case "murfmodel":
        if (!ctx.policy.allowModelId) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), model: ctx.value },
        };
      case "style":
      case "murf_style":
      case "murfstyle":
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), style: ctx.value },
        };
      case "rate":
      case "murf_rate":
      case "murfrate": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const value = parseNumberValue(ctx.value);
        if (value == null) {
          return { handled: true, warnings: ["invalid rate value"] };
        }
        requireInRange(value, -50, 50, "rate");
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), rate: value },
        };
      }
      case "pitch":
      case "murf_pitch":
      case "murfpitch": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const value = parseNumberValue(ctx.value);
        if (value == null) {
          return { handled: true, warnings: ["invalid pitch value"] };
        }
        requireInRange(value, -50, 50, "pitch");
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), pitch: value },
        };
      }
      case "locale":
      case "murf_locale":
      case "murflocale":
        if (!ctx.policy.allowNormalization) {
          return { handled: true };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), locale: ctx.value },
        };
      case "format":
      case "murf_format":
      case "murfformat": {
        if (!ctx.policy.allowVoiceSettings) {
          return { handled: true };
        }
        const normalized = normalizeFormat(ctx.value);
        if (!normalized) {
          return { handled: true, warnings: [`invalid format "${ctx.value}"`] };
        }
        return {
          handled: true,
          overrides: { ...(ctx.currentOverrides ?? {}), format: normalized },
        };
      }
      default:
        return { handled: false };
    }
  } catch (error) {
    return {
      handled: true,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/** Build the Murf speech provider plugin. */
export function buildMurfSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "murf",
    label: "Murf",
    autoSelectOrder: 30,
    models: MURF_TTS_MODELS,
    resolveConfig: ({ rawConfig }) => normalizeMurfProviderConfig(rawConfig),
    parseDirectiveToken: parseMurfDirectiveToken,
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeMurfProviderConfig(baseTtsConfig);
      const resolvedTalkApiKey =
        talkProviderConfig.apiKey === undefined
          ? undefined
          : normalizeResolvedSecretInputString({
              value: talkProviderConfig.apiKey,
              path: "talk.providers.murf.apiKey",
            });
      return {
        ...base,
        ...(resolvedTalkApiKey === undefined ? {} : { apiKey: resolvedTalkApiKey }),
        ...(trimToUndefined(talkProviderConfig.voiceId) == null
          ? {}
          : { voiceId: trimToUndefined(talkProviderConfig.voiceId) }),
        ...(trimToUndefined(talkProviderConfig.model) == null
          ? {}
          : { model: normalizeMurfModelField(trimToUndefined(talkProviderConfig.model)) }),
        ...(trimToUndefined(talkProviderConfig.locale) == null
          ? {}
          : { locale: trimToUndefined(talkProviderConfig.locale) }),
        ...(trimToUndefined(talkProviderConfig.style) == null
          ? {}
          : { style: trimToUndefined(talkProviderConfig.style) }),
        ...(asNumber(talkProviderConfig.rate) == null
          ? {}
          : { rate: asNumber(talkProviderConfig.rate) }),
        ...(asNumber(talkProviderConfig.pitch) == null
          ? {}
          : { pitch: asNumber(talkProviderConfig.pitch) }),
        ...(trimToUndefined(talkProviderConfig.region) == null
          ? {}
          : { region: normalizeMurfRegion(trimToUndefined(talkProviderConfig.region)) }),
        ...(normalizeFormat(talkProviderConfig.format) == null
          ? {}
          : { format: normalizeFormat(talkProviderConfig.format) }),
        ...(asNumber(talkProviderConfig.sampleRate) == null
          ? {}
          : { sampleRate: asNumber(talkProviderConfig.sampleRate) }),
      };
    },
    resolveTalkOverrides: ({ params }) => {
      return {
        ...(trimToUndefined(params.voiceId) == null
          ? {}
          : { voiceId: trimToUndefined(params.voiceId) }),
        ...(trimToUndefined(params.model) == null
          ? {}
          : { model: normalizeMurfModelField(trimToUndefined(params.model)) }),
        ...(trimToUndefined(params.style) == null
          ? {}
          : { style: trimToUndefined(params.style) }),
        ...(asNumber(params.rate) == null ? {} : { rate: asNumber(params.rate) }),
        ...(asNumber(params.pitch) == null ? {} : { pitch: asNumber(params.pitch) }),
        ...(trimToUndefined(params.locale) == null
          ? {}
          : { locale: trimToUndefined(params.locale) }),
        ...(normalizeFormat(params.format) == null
          ? {}
          : { format: normalizeFormat(params.format) }),
      };
    },
    isConfigured: ({ providerConfig }) =>
      Boolean(readMurfProviderConfig(providerConfig).apiKey || process.env.MURF_API_KEY),
    listVoices: async (req) => {
      const config = req.providerConfig ? readMurfProviderConfig(req.providerConfig) : undefined;
      const apiKey = req.apiKey || config?.apiKey || process.env.MURF_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Murf API key missing. Set MURF_API_KEY in your environment or add apiKey to the Murf provider config.",
        );
      }
      return listMurfVoices({ apiKey, model: config?.model });
    },
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

      const modelOverride = trimToUndefined(overrides.model);
      const effectiveModel = normalizeMurfModelField(modelOverride ?? config.model);

      const audioBuffer = await murfTTS({
        text: req.text,
        apiKey,
        voiceId: trimToUndefined(overrides.voiceId) ?? config.voiceId,
        model: effectiveModel,
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
