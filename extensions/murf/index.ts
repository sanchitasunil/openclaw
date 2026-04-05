import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildMurfSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "murf",
  name: "Murf Falcon Speech",
  description: "Bundled Murf Falcon speech provider",
  register(api) {
    api.registerSpeechProvider(buildMurfSpeechProvider());
  },
});
