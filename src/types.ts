import type { IconProps } from "@opencode-ai/ui/icon";
import type { OpenCodeClient } from "@opencode-ai/client";
import type { JSX } from "solid-js";

export type Dispose = () => void;

export interface MountContext {
  signal: AbortSignal;
}

export type Mount = (
  target: HTMLElement,
  context: MountContext,
) => void | Dispose;

export interface Cell<T> {
  get(): T;
  set(value: T | ((current: T) => T)): void;
  subscribe(listener: (value: T) => void): Dispose;
  /** Runs immediately with the current value, then again on every change. */
  effect(run: (value: T) => void): Dispose;
}

export interface StateValueOptions<T> {
  default: T;
  decode(value: unknown): T | undefined;
}

export interface ExtensionState {
  boolean(key: string, defaultValue: boolean): Cell<boolean>;
  number(
    key: string,
    defaultValue: number,
    options?: { min?: number; max?: number },
  ): Cell<number>;
  string(key: string, defaultValue: string): Cell<string>;
  value<T>(key: string, options: StateValueOptions<T>): Cell<T>;
}

export interface ExtensionLifecycle {
  signal: AbortSignal;
  own(dispose: Dispose): Dispose;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): Dispose;
  observe(
    target: Node,
    options: MutationObserverInit,
    callback: MutationCallback,
  ): Dispose;
}

export interface ExtensionAssets {
  url(path: string): string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export type MainExtensionMethods = Record<
  string,
  (...args: any[]) => unknown
>;

export interface MainExtensionDefinition<
  TMethods extends MainExtensionMethods = MainExtensionMethods,
> {
  activate(context: MainExtensionContext): TMethods;
}

export type MainExtensionClient<TDefinition> =
  TDefinition extends MainExtensionDefinition<infer TMethods>
    ? {
        [TKey in keyof TMethods]: TMethods[TKey] extends (
          ...args: infer TArguments
        ) => infer TResult
          ? (...args: TArguments) => Promise<Awaited<TResult>>
          : never;
      }
    : never;

export interface ExtensionMainBridge {
  <TDefinition extends MainExtensionDefinition>(): MainExtensionClient<TDefinition>;
}

export interface SurfaceContribution {
  id: string;
  order?: number;
  mount: Mount;
}

export interface SettingsContribution extends SurfaceContribution {
  anchor?: string;
  placement?: "before" | "after";
}

export interface SettingsPageContribution {
  id: string;
  after?: string;
  navigation: Mount;
  mount: Mount;
}

export type PaneSide = "left" | "right" | "top" | "bottom";

export interface PaneOptions extends SurfaceContribution {
  side: PaneSide;
  size: number;
  minSize?: number;
  maxSize?: number;
  open?: boolean;
  resizable?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSizeChange?: (size: number) => void;
}

export interface PaneController {
  open(): boolean;
  size(): number;
  show(): void;
  hide(): void;
  toggle(): void;
  resize(size: number): void;
  dispose(): void;
}

export interface UnsafeDesktopSurfaces {
  titlebar: {
    add(contribution: SurfaceContribution): Dispose;
  };
  settings: {
    add(contribution: SettingsContribution): Dispose;
    addPage(contribution: SettingsPageContribution): Dispose;
  };
  layout: {
    addPane(options: PaneOptions): PaneController;
  };
  review: {
    addPane(options: PaneOptions): PaneController;
  };
}

export type DesktopIcon = IconProps["name"] | (() => JSX.Element);

export interface DesktopTitlebar {
  action(options: {
    id: string;
    label: string;
    icon: DesktopIcon;
    order?: number;
    onPress(): void;
  }): Dispose;
  toggle(options: {
    id: string;
    label: string;
    icon(checked: boolean): JSX.Element;
    checked: Cell<boolean>;
    order?: number;
  }): Dispose;
}

export interface DesktopSettings {
  toggle(options: {
    id: string;
    title: string;
    description?: string;
    value: Cell<boolean>;
    badge?: string;
  }): Dispose;
  page(options: {
    id: string;
    title: string;
    icon: DesktopIcon;
    /** Settings tab value to insert after, e.g. "shortcuts" or "extensions". */
    after?: string;
    mount: Mount;
  }): Dispose;
}

export interface DesktopPane {
  open: Cell<boolean>;
  size: Cell<number>;
  show(): void;
  hide(): void;
  toggle(): void;
  dispose(): void;
}

export interface DesktopPanes {
  add(options: {
    id: string;
    surface?: "app" | "review";
    side: PaneSide;
    size: Cell<number>;
    open?: Cell<boolean>;
    minSize?: number;
    maxSize?: number;
    resizable?: boolean;
    mount: Mount;
  }): DesktopPane;
}

export interface DesktopTab {
  id: string;
  title: string;
  active: boolean;
  href?: string;
  session?: {
    id: string;
    server: string;
  };
}

export interface DesktopTabs {
  snapshot(): readonly DesktopTab[];
  subscribe(listener: (tabs: readonly DesktopTab[]) => void): Dispose;
  activate(id: string): boolean;
  close(id: string): boolean;
  create(): boolean;
}

export interface OpenCodeDesktop {
  titlebar: DesktopTitlebar;
  settings: DesktopSettings;
  panes: DesktopPanes;
  tabs: DesktopTabs;
}

export interface OpenCodeConnection {
  key: string;
  url: string;
  username?: string;
  password?: string;
}

export interface OpenCodeSessionContext {
  id: string;
  server: string;
}

export interface OpenCodeSDK {
  currentSession: Cell<OpenCodeSessionContext | undefined>;
  connection(server?: string): Promise<OpenCodeConnection>;
  client(options?: { server?: string }): Promise<OpenCodeClient>;
}

export interface ExtensionContext {
  id: string;
  lifecycle: ExtensionLifecycle;
  assets: ExtensionAssets;
  main: ExtensionMainBridge;
  state: ExtensionState;
  opencode: OpenCodeSDK;
  desktop: OpenCodeDesktop;
  unsafe: UnsafeDesktopSurfaces;
}

export interface ExtensionSource {
  styles?: string | readonly string[];
  activate(context: ExtensionContext): void | Dispose;
}

export interface ExtensionDefinition extends ExtensionSource {
  id: string;
  name: string;
}

export interface MainExtensionLifecycle {
  signal: AbortSignal;
  own(dispose: Dispose): Dispose;
}

export interface MainExtensionContext {
  id: string;
  lifecycle: MainExtensionLifecycle;
}

export interface ExtensionHost {
  register(extension: ExtensionDefinition): Dispose;
  dispose(): void;
}
