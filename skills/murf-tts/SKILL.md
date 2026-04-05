---
name: murf-tts
description: High-quality TTS via Murf Falcon (cloud, streaming)
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

Cloud text-to-speech using the Murf Falcon model. Produces high-quality, natural-sounding audio in multiple voices, styles, and locales.

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
        region: "global", // "global", "in", "us-east"
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

Once configured, TTS output automatically uses Murf Falcon:

```bash
openclaw tts "Hello from Falcon"
```

The agent will use Murf for all voice output. If Murf is unavailable, OpenClaw automatically falls back to other configured providers (OpenAI, ElevenLabs, Microsoft Edge).

## Voice Options

| Parameter  | Values                           | Default       |
| ---------- | -------------------------------- | ------------- |
| voiceId    | "en-US-natalie", "Matthew", etc. | en-US-natalie |
| model      | "FALCON", "GEN2"                 | FALCON        |
| locale     | "en-US", "en-UK", "es-ES", etc.  | en-US         |
| style      | "Conversation", "Newscast", etc. | Conversation  |
| rate       | -50 to 50                        | 0             |
| pitch      | -50 to 50                        | 0             |
| region     | "global", "in", "us-east"        | global        |
| format     | "MP3", "WAV", "OGG", "FLAC"      | MP3           |
| sampleRate | 8000, 16000, 24000, 44100, 48000 | 24000         |

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
