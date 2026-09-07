import type { Dispose, ExtensionDefinition, ExtensionSource } from "./types";

declare global {
  var __ocdx:
    | {
        register(extension: ExtensionDefinition): Dispose;
        disable(extensionID: string): void;
        dispose(): void;
      }
    | undefined;
}

export type {
  Cell,
  DesktopPane,
  DesktopTab,
  DesktopTabs,
  DesktopSidePanel,
  SidePanelTab,
  ReadonlyCell,
  Dispose,
  ExtensionAssets,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionSource,
  ExtensionLifecycle,
  ExtensionMainBridge,
  ExtensionState,
  Mount,
  OpenCodeConnection,
  OpenCodeDesktop,
  OpenCodeSDK,
  OpenCodeSessionContext,
  PaneSide,
} from "./types";

export function defineExtension<T extends ExtensionSource>(extension: T) {
  return extension;
}

export function registerExtension(
  extension: ExtensionSource,
  identity: Pick<ExtensionDefinition, "id" | "name">,
) {
  if (!globalThis.__ocdx) throw new Error("OCDX runtime is not available");
  return globalThis.__ocdx.register({ ...extension, ...identity });
}
