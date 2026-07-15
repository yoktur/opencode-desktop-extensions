import { createExtensionHost } from "./host";
import type { Dispose } from "./types";

globalThis.__ocdx?.dispose();

const host = createExtensionHost();
const extensions = new Map<string, Dispose>();
globalThis.__ocdx = {
  register(extension) {
    extensions.get(extension.id)?.();
    const dispose = host.register(extension);
    extensions.set(extension.id, dispose);
    return () => {
      if (extensions.get(extension.id) !== dispose) return;
      extensions.delete(extension.id);
      dispose();
    };
  },
  disable(extensionID) {
    extensions.get(extensionID)?.();
    extensions.delete(extensionID);
  },
  dispose() {
    extensions.clear();
    host.dispose();
    delete globalThis.__ocdx;
  },
};
