---
name: murf-tts
description: High-quality TTS via Murf (FALCON, cloud streaming)
metadata:
  {
    "openclaw":
      {
        "emoji": "\U0001F399",
        "os": ["darwin", "linux", "win32"],
        "requires": { "env": ["MURF_API_KEY"] },
      },
  }
---

# murf-tts

Cloud text-to-speech using Murf (FALCON for low latency). Produces natural-sounding audio in multiple voices, styles, and locales.

## Setup

1. Get an API key from [murf.ai](https://murf.ai).
2. Export it in your shell:

```bash
export MURF_API_KEY="your_key_here"
```

3. Set Murf as your TTS provider:

```bash
openclaw config set messages.tts.provider murf
```

Or add to `~/.openclaw/config.json`:

```json5
{
  messages: {
    tts: {
      provider: "murf",
      murf: {
        voiceId: "en-US-natalie", // or "Matthew", etc.
        model: "FALCON",
        region: "global", // see region list below
        locale: "en-US",
        style: "Conversation", // "Conversation", "Newscast", etc.
        format: "MP3",
        sampleRate: 24000,
      },
    },
  },
}
```

4. Restart the gateway:

```bash
openclaw gateway restart
```

## Usage

Once configured, TTS output automatically uses Murf:

```bash
openclaw tts "Hello from Murf"
```

The agent will use Murf for all voice output. If Murf is unavailable, OpenClaw automatically falls back to other configured providers (OpenAI, ElevenLabs, Microsoft Edge).

## Voice Options

| Parameter  | Values                           | Default                                 |
| ---------- | -------------------------------- | --------------------------------------- |
| voiceId    | "en-US-natalie", "Matthew", etc. | en-US-natalie                           |
| model      | "FALCON"                         | FALCON                                  |
| locale     | "en-US", "en-UK", "es-ES", etc.  | en-US                                   |
| style      | "Conversation", "Newscast", etc. | Conversation                            |
| rate       | -50 to 50                        | 0                                       |
| pitch      | -50 to 50                        | 0                                       |
| region     | Murf API region ids (see below)  | global                                  |
| format     | "MP3", "WAV", "OGG", "FLAC"      | MP3                                     |
| sampleRate | 8000, 16000, 24000, 44100, 48000 | 24000 if omitted                        |

### Regions (`messages.tts` / `providers.murf.region`)

Pinned regional hosts match the Murf API: `au`, `ca`, `eu-central`, `global`, `in`, `jp`, `kr`, `me`, `sa-east`, `uk`, `us-east`, `us-west`. Unknown values fall back to `global`.

## MCP Fallback

For additional flexibility, you can also register the `murf-mcp` server as an MCP tool. The agent can invoke it directly when native TTS is unavailable:

```json5
{
  mcp: {
    servers: {
      murf: {
        command: "uvx",
        args: ["murf-mcp"],
        env: { MURF_API_KEY: "${MURF_API_KEY}" },
      },
    },
  },
}
```
