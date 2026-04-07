import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildMurfSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "murf",
  name: "Murf Speech",
  description: "Bundled Murf speech provider (FALCON and GEN2)",
  register(api) {
    api.registerSpeechProvider(buildMurfSpeechProvider());
  },
});
