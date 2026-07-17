import type { ExtensionMainBridge } from "./types";

export function createExtensionMainBridge(
  extensionID: string,
  signal: AbortSignal,
): ExtensionMainBridge {
  return (() =>
    new Proxy(
      {},
      {
        get(_target, method) {
          if (method === "then") return undefined;
          if (
            typeof method !== "string" ||
            !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(method)
          ) {
            throw new Error(`Invalid main extension method: ${String(method)}`);
          }
          return async (...args: unknown[]) => {
            const response = await fetch(
              `ocdx://main/${encodeURIComponent(extensionID)}/${encodeURIComponent(method)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ args }),
                signal,
              },
            );
            const result = (await response.json()) as {
              value?: unknown;
              error?: string;
            };
            if (!response.ok) {
              throw new Error(
                result.error || `Main extension failed with status ${response.status}`,
              );
            }
            return result.value;
          };
        },
      },
    )) as ExtensionMainBridge;
}
