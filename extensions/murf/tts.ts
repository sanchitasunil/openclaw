import {
  asObject,
  readResponseTextLimited,
  requireInRange,
  trimToUndefined,
  truncateErrorDetail,
} from "openclaw/plugin-sdk/speech";

/** Subdomain for `https://<id>.api.murf.ai` (see Murf Stream Speech API regional URLs). */
export const MURF_API_REGIONS = [
  "au",
  "ca",
  "eu-central",
  "global",
  "in",
  "jp",
  "kr",
  "me",
  "sa-east",
  "uk",
  "us-east",
  "us-west",
] as const;

const MURF_REGIONS = new Set<string>(MURF_API_REGIONS);

const MURF_MODELS = new Set(["FALCON", "GEN2"]);

const MURF_FORMATS = new Set(["MP3", "WAV", "OGG", "FLAC"]);
const MURF_SAMPLE_RATES = new Set([8000, 16000, 24000, 44100, 48000]);
const MURF_MAX_TEXT_LENGTH = 5000;
const MURF_MAX_RETRIES = 3;
const MURF_RETRY_BASE_MS = 1000;

/** Strip control characters except tab (\t), newline (\n), carriage return (\r). */
function stripControlChars(input: string): string {
  let result = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 || code === 9 || code === 10 || code === 13) {
      if (code !== 0x7f) {
        result += ch;
      }
    }
  }
  return result;
}

export function normalizeMurfRegion(region?: string): string {
  const trimmed = region?.trim().toLowerCase();
  return trimmed && MURF_REGIONS.has(trimmed) ? trimmed : "global";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Parse a structured Murf API error payload, extracting the most useful
 * human-readable detail string. Mirrors ElevenLabs' JSON error parsing.
 */
export function formatMurfErrorPayload(payload: unknown): string | undefined {
  const root = asObject(payload);
  if (!root) {
    return undefined;
  }
  const detailObject = asObject(root.detail);
  const message =
    trimToUndefined(root.message) ??
    trimToUndefined(detailObject?.message) ??
    trimToUndefined(detailObject?.detail) ??
    trimToUndefined(root.error);
  const code =
    trimToUndefined(root.code) ??
    trimToUndefined(detailObject?.code) ??
    trimToUndefined(detailObject?.status);
  if (message && code) {
    return `${truncateErrorDetail(message)} [code=${code}]`;
  }
  if (message) {
    return truncateErrorDetail(message);
  }
  if (code) {
    return `[code=${code}]`;
  }
  return undefined;
}

/**
 * Extract a human-readable error detail from a Murf API error response.
 * Attempts JSON parsing first; falls back to raw body text.
 */
async function extractMurfErrorDetail(response: Response): Promise<string | undefined> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  if (!rawBody) {
    return undefined;
  }
  try {
    return formatMurfErrorPayload(JSON.parse(rawBody)) ?? truncateErrorDetail(rawBody);
  } catch {
    return truncateErrorDetail(rawBody);
  }
}

/**
 * Extract a request/trace ID from Murf API response headers, if present.
 * Useful for support tickets and debugging.
 */
function extractMurfRequestId(response: Response): string | undefined {
  return (
    trimToUndefined(response.headers.get("x-request-id")) ??
    trimToUndefined(response.headers.get("request-id"))
  );
}

export type MurfTtsParams = {
  text: string;
  apiKey: string;
  voiceId: string;
  model: string;
  locale: string;
  style: string;
  rate: number;
  pitch: number;
  region: string;
  format: string;
  sampleRate: number;
  channelType?: string;
  timeoutMs: number;
};

export async function murfTTS(params: MurfTtsParams): Promise<Buffer> {
  const {
    apiKey,
    voiceId,
    model,
    locale,
    style,
    rate,
    pitch,
    format,
    sampleRate,
    channelType = "MONO",
    timeoutMs,
  } = params;

  const modelNorm = model.trim().toUpperCase();
  if (!MURF_MODELS.has(modelNorm)) {
    throw new Error(`Murf TTS: unsupported model "${model}" (expected FALCON or GEN2)`);
  }

  const text = stripControlChars(params.text).trim();
  if (!text) {
    throw new Error("Murf TTS: text must not be empty");
  }
  if (text.length > MURF_MAX_TEXT_LENGTH) {
    throw new Error(
      `Murf TTS: text exceeds ${MURF_MAX_TEXT_LENGTH} character limit (${text.length})`,
    );
  }
  requireInRange(rate, -50, 50, "rate");
  requireInRange(pitch, -50, 50, "pitch");
  if (!MURF_FORMATS.has(format)) {
    throw new Error(`Murf TTS: unsupported format "${format}" (expected MP3, WAV, OGG, or FLAC)`);
  }
  if (!MURF_SAMPLE_RATES.has(sampleRate)) {
    throw new Error(
      `Murf TTS: unsupported sampleRate ${sampleRate} (expected 8000, 16000, 24000, 44100, or 48000)`,
    );
  }

  const region = normalizeMurfRegion(params.region);
  const url = `https://${region}.api.murf.ai/v1/speech/stream`;
  const body = JSON.stringify({
    text,
    voiceId,
    model: modelNorm,
    format,
    locale,
    style,
    rate,
    pitch,
    sampleRate,
    channelType,
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MURF_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) {
          throw new Error("Murf TTS: received empty audio response");
        }
        return buffer;
      }

      // Non-retryable client errors (400/401/402/403) — throw immediately.
      if (!isRetryableStatus(response.status)) {
        const detail = await extractMurfErrorDetail(response);
        const requestId = extractMurfRequestId(response);
        throw new Error(
          `Murf TTS API error (${response.status})` +
            (detail ? `: ${detail}` : "") +
            (requestId ? ` [request_id=${requestId}]` : ""),
        );
      }

      const detail = await extractMurfErrorDetail(response);
      const requestId = extractMurfRequestId(response);
      lastError = new Error(
        `Murf TTS API error (${response.status})` +
          (detail ? `: ${detail}` : "") +
          (requestId ? ` [request_id=${requestId}]` : ""),
      );
    } catch (err) {
      // Abort / network errors are not retried here.
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }

    // Exponential backoff before next attempt (1s, 2s, 4s).
    if (attempt < MURF_MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, MURF_RETRY_BASE_MS * 2 ** attempt));
    }
  }

  throw lastError ?? new Error("Murf TTS: all retries exhausted");
}
