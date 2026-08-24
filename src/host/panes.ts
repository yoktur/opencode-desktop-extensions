import type { PaneController, PaneOptions, PaneSide } from "../types";
import type { ContributionRecord, Mounter } from "./mounts";

type PaneSurfaceKind = "layout" | "review";

type PaneRecord = ContributionRecord & {
  surface: PaneSurfaceKind;
  side: PaneSide;
  value: {
    open: boolean;
    size: number;
  };
  minSize: number;
  maxSize: number;
  resizable: boolean;
  onOpenChange?: (open: boolean) => void;
  onSizeChange?: (size: number) => void;
};

const SIDES: PaneSide[] = ["left", "right", "top", "bottom"];

export type PaneSurface = ReturnType<typeof createPaneSurface>;

export function createPaneSurface(doc: Document, mounter: Mounter) {
  const panes = new Set<PaneRecord>();

  const paneSize = (record: PaneRecord) =>
    record.value.open ? record.value.size : 0;
  const sideSize = (surface: PaneSurfaceKind, side: PaneSide) =>
    Array.from(panes)
      .filter((record) => record.surface === surface && record.side === side)
      .reduce((total, record) => total + paneSize(record), 0);

  const updatePane = (record: PaneRecord) => {
    if (record.state.kind !== "mounted") return;
    const slot = record.state.slot;
    slot.hidden = !record.value.open;
    slot.style.flexBasis = `${record.value.size}px`;
    if (record.side === "left" || record.side === "right") {
      slot.style.width = `${record.value.size}px`;
      slot.style.height = "100%";
      return;
    }
    slot.style.width = "100%";
    slot.style.height = `${record.value.size}px`;
  };

  const resize = (record: PaneRecord, value: number) => {
    const size = Math.max(
      record.minSize,
      Math.min(record.maxSize, Math.round(value)),
    );
    if (size === record.value.size) return;
    record.value.size = size;
    record.onSizeChange?.(size);
    reconcile();
  };

  const addResizeHandle = (record: PaneRecord) => {
    if (!record.resizable || record.state.kind !== "mounted") return;
    const handle = doc.createElement("div");
    handle.dataset.opencodeModResize = "";
    handle.addEventListener("pointerdown", (start) => {
      start.preventDefault();
      handle.setPointerCapture(start.pointerId);
      const initial = record.value.size;
      const move = (event: PointerEvent) => {
        const delta =
          record.side === "left"
            ? event.clientX - start.clientX
            : record.side === "right"
              ? start.clientX - event.clientX
              : record.side === "top"
                ? event.clientY - start.clientY
                : start.clientY - event.clientY;
        resize(record, initial + delta);
      };
      const stop = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", stop);
        doc.removeEventListener("pointercancel", stop);
        if (handle.hasPointerCapture(start.pointerId))
          handle.releasePointerCapture(start.pointerId);
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", stop);
      doc.addEventListener("pointercancel", stop);
    });
    record.state.slot.append(handle);
  };

  const ensureRail = (
    target: HTMLElement,
    surface: PaneSurfaceKind,
    side: PaneSide,
  ) => {
    const attribute =
      surface === "layout"
        ? "data-opencode-mod-layout-rail"
        : "data-opencode-mod-review-rail";
    const existing = Array.from(target.children).find(
      (child) => child.getAttribute(attribute) === side,
    );
    if (existing instanceof HTMLElement) return existing;
    const rail = doc.createElement("div");
    rail.setAttribute(attribute, side);
    target.append(rail);
    return rail;
  };

  const mountAll = (
    records: PaneRecord[],
    surface: PaneSurfaceKind,
    target: HTMLElement,
  ) => {
    records.forEach((record) => {
      const before = record.state;
      mounter.mount(record, ensureRail(target, surface, record.side), {
        "data-opencode-mod-pane": record.key,
        "data-opencode-mod-pane-side": record.side,
      });
      if (record.state !== before) addResizeHandle(record);
      updatePane(record);
    });
    SIDES.forEach((side) => {
      const size = sideSize(surface, side);
      const property =
        surface === "layout"
          ? `--opencode-mod-layout-${side}`
          : `--opencode-mod-review-${side}`;
      target.style.setProperty(property, `${size}px`);
      const rail = ensureRail(target, surface, side);
      if (side === "left" || side === "right") rail.style.width = `${size}px`;
      if (side === "top" || side === "bottom") rail.style.height = `${size}px`;
    });
  };

  const reconcileLayout = () => {
    const records = Array.from(panes).filter(
      (record) => record.surface === "layout",
    );
    if (records.length === 0) {
      doc
        .querySelectorAll<HTMLElement>("[data-opencode-mod-layout-shell]")
        .forEach((shell) => {
          shell
            .querySelectorAll(":scope > [data-opencode-mod-layout-rail]")
            .forEach((rail) => rail.remove());
          shell.removeAttribute("data-opencode-mod-layout-shell");
          SIDES.forEach((side) =>
            shell.style.removeProperty(`--opencode-mod-layout-${side}`),
          );
        });
      return;
    }
    const header = doc.querySelector<HTMLElement>(
      'header[data-slot="titlebar-v2"]',
    );
    const shell = header?.parentElement;
    if (
      !header ||
      !shell ||
      !Array.from(shell.children).some((child) => child.tagName === "MAIN")
    ) {
      records.forEach(mounter.unmount);
      return;
    }

    shell.dataset.opencodeModLayoutShell = "";
    shell.style.setProperty(
      "--opencode-mod-titlebar-height",
      `${Math.round(header.getBoundingClientRect().height) || 36}px`,
    );
    mountAll(records, "layout", shell);
  };

  const reconcileReview = () => {
    const records = Array.from(panes).filter(
      (record) => record.surface === "review",
    );
    if (records.length === 0) {
      doc
        .querySelectorAll<HTMLElement>(
          "#review-panel[data-opencode-mod-review]",
        )
        .forEach((review) => {
          review
            .querySelectorAll(":scope > [data-opencode-mod-review-rail]")
            .forEach((rail) => rail.remove());
          review.removeAttribute("data-opencode-mod-review");
          SIDES.forEach((side) =>
            review.style.removeProperty(`--opencode-mod-review-${side}`),
          );
        });
      return;
    }
    const review = doc.getElementById("review-panel");
    if (!review) {
      records.forEach(mounter.unmount);
      return;
    }

    review.dataset.opencodeModReview = "";
    mountAll(records, "review", review);
  };

  const reconcile = () => {
    reconcileLayout();
    reconcileReview();
  };

  const add = (
    extensionID: string,
    surface: PaneSurfaceKind,
    options: PaneOptions,
  ): PaneController => {
    const size = Math.max(
      options.minSize ?? 160,
      Math.min(options.maxSize ?? 800, Math.round(options.size)),
    );
    const record: PaneRecord = {
      key: `${extensionID}/${options.id}`,
      extensionID,
      order: options.order ?? 0,
      mount: options.mount,
      state: { kind: "unmounted" },
      surface,
      side: options.side,
      value: {
        open: options.open ?? true,
        size,
      },
      minSize: options.minSize ?? 160,
      maxSize: options.maxSize ?? 800,
      resizable: options.resizable ?? true,
      onOpenChange: options.onOpenChange,
      onSizeChange: options.onSizeChange,
    };
    panes.add(record);
    reconcile();

    const setOpen = (open: boolean) => {
      if (record.value.open === open) return;
      record.value.open = open;
      record.onOpenChange?.(open);
      reconcile();
    };
    return {
      open: () => record.value.open,
      size: () => record.value.size,
      show: () => setOpen(true),
      hide: () => setOpen(false),
      toggle: () => setOpen(!record.value.open),
      resize: (value) => resize(record, value),
      dispose() {
        panes.delete(record);
        mounter.unmount(record);
        reconcile();
      },
    };
  };

  return {
    add,
    reconcile,
    unmountAll: () => panes.forEach(mounter.unmount),
  };
}
