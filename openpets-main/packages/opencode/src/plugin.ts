import { createOpenPetsOpenCodeHooks, type OpenCodePluginOptions } from "./opencode-plugin-runtime.js";

export const openPetsOpenCodePluginId = "open-pets-opencode";

const plugin = {
  id: openPetsOpenCodePluginId,
  server: async (_input: unknown, options?: OpenCodePluginOptions) => createOpenPetsOpenCodeHooks(options ?? {}),
};

export default plugin;
