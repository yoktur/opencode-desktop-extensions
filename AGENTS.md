# Repository Guidance

## Primitives Vs. Extensions

> the keep awake should only live as custom extension code - not a core ocdx api.

> you need to be smarter about what is a good reusable primitive for building ON, vs a custom extension

Core OCDX APIs must be capability-neutral building blocks that enable multiple unrelated extensions. Product behavior, user-facing policy, and feature-specific state belong in extension code.

Before adding a core API, identify at least two meaningfully different extension use cases that need the same primitive. If the proposed API names or encodes one feature's behavior, keep it in that extension and expose only the narrower lifecycle, contribution, messaging, or host boundary needed to implement it.

For trusted main-process behavior, prefer a generic extension main entry and extension-scoped communication primitive. Do not add feature-specific wrappers such as power, media, timer, or process APIs merely to support one example extension.

## SDK Evolution

> ocdx is a proof of concept.

> breaking changes are preferred - with no fallbacks.

> improve the SDK at any cost.

OCDX has no public compatibility commitment yet. Prefer the cleanest durable interface even when it requires breaking existing examples or callers. Remove replaced interfaces and behavior outright; do not add compatibility overloads, aliases, deprecations, migration shims, or fallback behavior.

Always get the user's explicit approval before changing an OCDX public SDK interface. Present the proposed interface, explain why it is a better primitive, and wait for approval before implementation.
