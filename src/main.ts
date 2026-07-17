import type {
  MainExtensionContext,
  MainExtensionDefinition,
  MainExtensionMethods,
} from "./types";

export type {
  Dispose,
  MainExtensionContext,
  MainExtensionDefinition,
  MainExtensionLifecycle,
  MainExtensionMethods,
} from "./types";

export function defineMainExtension<TMethods extends MainExtensionMethods>(
  activate: (context: MainExtensionContext) => TMethods,
): MainExtensionDefinition<TMethods> {
  return { activate };
}
