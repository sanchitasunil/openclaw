# Murf Speech Provider for OpenClaw

Bundled speech provider plugin that adds [Murf AI](https://murf.ai) text-to-speech
to OpenClaw. Supports the **FALCON** (low-latency, ~130 ms) and **GEN2**
(studio-quality) models with 150+ voices across 35 languages.

## Install

### Bundled (upstream)

Already included when running from the OpenClaw monorepo. No extra steps.

### Community plugin (ClawHub / npm)

```bash
openclaw plugins install @openclaw/murf-speech
```

## Configuration

### 1. Set your API key

Get a key from [murf.ai](https://murf.ai) and export it:

```bash
export MURF_API_KEY="your_key_here"
```

Or put it in your OpenClaw config:

```json5
{
  messages: {
    tts: {
      providers: {
        murf: { apiKey: "your_key_here" }
      }
    }
  }
}
```

### 2. Select Murf as the TTS provider

```bash
openclaw config set messages.tts.provider murf
```

### 3. (Optional) Customise defaults

```json5
{
  messages: {
    tts: {
      provider: "murf",
      providers: {
        murf: {
          voiceId: "en-US-natalie",  // any Murf voice ID
          model: "FALCON",           // "FALCON" or "GEN2"
          locale: "en-US",           // BCP-47 locale
          style: "Conversation",     // speaking style
          rate: 0,                   // -50 to 50
          pitch: 0,                  // -50 to 50
          region: "global",          // API region (see below)
          format: "MP3",             // MP3, WAV, OGG, FLAC
          sampleRate: 24000          // 8000, 16000, 24000, 44100, 48000
        }
      }
    }
  }
}
```

Restart the gateway after changing config:

```bash
openclaw gateway restart
```

## Supported models

| Model   | Latency | Quality        | Default sample rate |
|---------|---------|----------------|---------------------|
| FALCON  | ~130 ms | Conversational | 24 000 Hz           |
| GEN2    | Higher  | Studio         | 44 100 Hz           |

## Voices

Run `openclaw voices list` (requires a configured API key) to see all
available voices. You can filter by model:

```bash
openclaw voices list --provider murf
```

Voices are identified by ID (e.g. `en-US-natalie`, `en-US-jackson`).
Each voice supports one or more locales and speaking styles.

## Regions

The streaming TTS endpoint is available in 12 regions. Set `region` in
config or leave it as `global` (auto-routes to nearest):

`au`, `ca`, `eu-central`, `global`, `in`, `jp`, `kr`, `me`, `sa-east`,
`uk`, `us-east`, `us-west`

## Streaming behaviour

The Murf `/v1/speech/stream` endpoint returns audio via **chunked transfer
encoding** — audio bytes arrive progressively as they are generated.

The current OpenClaw integration **buffers the full response** before
returning it to the speech pipeline. True streaming playback (start
playing before the full buffer arrives) is not yet implemented; this
matches the ElevenLabs provider's behaviour.

## In-message directives

When directive overrides are enabled, users can tweak Murf parameters
inline:

```
@tts voiceid=en-US-jackson model=GEN2 style=Newscast rate=10
```

Supported directive keys: `voiceid` / `murf_voice`, `model` / `murf_model`,
`style`, `rate`, `pitch`, `locale`, `format`.

## Audio formats

| Format | MIME type    | Notes                                      |
|--------|--------------|--------------------------------------------|
| MP3    | audio/mpeg   | Default; smallest file size                |
| WAV    | audio/wav    | Uncompressed; largest file                 |
| OGG    | audio/ogg    | Used automatically for voice-note targets  |
| FLAC   | audio/flac   | Lossless compression                       |

Voice-note targets (Telegram, WhatsApp) automatically switch to OGG so
the audio plays as a native voice bubble.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Murf API key missing` | Set `MURF_API_KEY` env var or add `apiKey` to provider config |
| `Murf TTS API error (401)` | API key is invalid or expired — regenerate at murf.ai |
| `Murf TTS API error (429)` | Rate limited — the provider retries automatically (3 attempts with exponential backoff). Reduce request volume or upgrade your Murf plan |
| `unsupported model` | Use `FALCON` or `GEN2` (case-insensitive) |
| `text exceeds 5000 character limit` | Split long text into smaller chunks |
| `unsupported sampleRate` | Use one of: 8000, 16000, 24000, 44100, 48000 |
| `received empty audio response` | The API returned no audio data. Verify your voice ID and locale are valid |
| Voice notes not playable | Ensure format is OGG (automatic for `voice-note` target) |

## Testing

```bash
# Unit tests (no API key needed)
npx vitest run extensions/murf/tts.test.ts extensions/murf/speech-provider.test.ts

# Live integration tests (requires MURF_API_KEY)
MURF_API_KEY=your_key npx vitest run --config vitest.live.config.ts extensions/murf/murf.live.test.ts
```

## Related

- [SKILL.md](../../skills/murf-tts/SKILL.md) — end-user skill documentation
- [Murf API docs](https://murf.ai/api/docs) — upstream API reference
- [ElevenLabs provider](../elevenlabs/) — reference implementation this plugin mirrors
