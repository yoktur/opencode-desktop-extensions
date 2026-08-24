import type { Cell, ExtensionState, StateValueOptions } from "./types";

export function createCell<T>(
  initial: T,
  onChange?: (value: T) => void,
): Cell<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const subscribe = (listener: (value: T) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get: () => value,
    set(next) {
      const valueNext =
        typeof next === "function" ? (next as (current: T) => T)(value) : next;
      if (Object.is(value, valueNext)) return;
      value = valueNext;
      onChange?.(value);
      listeners.forEach((listener) => listener(value));
    },
    subscribe,
    effect(run) {
      run(value);
      return subscribe(run);
    },
  };
}

export function createExtensionState(
  storage: Storage,
  extensionID: string,
): ExtensionState {
  const create = <T>(key: string, options: StateValueOptions<T>) => {
    const storageKey = `ocdx.extension.${extensionID}.${key}`;
    const stored = storage.getItem(storageKey);
    const decoded =
      stored === null ? undefined : decode(stored, options.decode);
    return createCell(decoded ?? options.default, (value) => {
      storage.setItem(storageKey, JSON.stringify(value));
    });
  };

  return {
    boolean: (key, defaultValue) =>
      create(key, {
        default: defaultValue,
        decode: (value) => (typeof value === "boolean" ? value : undefined),
      }),
    number: (key, defaultValue, options = {}) => {
      const clamp = (value: number) =>
        Math.max(
          options.min ?? -Infinity,
          Math.min(options.max ?? Infinity, value),
        );
      const cell = create(key, {
        default: clamp(defaultValue),
        decode: (value) =>
          typeof value === "number" && Number.isFinite(value)
            ? clamp(value)
            : undefined,
      });
      return {
        ...cell,
        set: (value) =>
          cell.set((current) =>
            clamp(typeof value === "function" ? value(current) : value),
          ),
      };
    },
    string: (key, defaultValue) =>
      create(key, {
        default: defaultValue,
        decode: (value) => (typeof value === "string" ? value : undefined),
      }),
    value: (key, options) => create(key, options),
  };
}

function decode<T>(
  value: string,
  decodeValue: (value: unknown) => T | undefined,
) {
  try {
    return decodeValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}
