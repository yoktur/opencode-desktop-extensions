import type { Dispose, Mount } from "../types";

export type Report = (error: unknown, extensionID: string) => void;

export type MountState =
  | { kind: "unmounted" }
  | {
      kind: "mounted";
      slot: HTMLElement;
      abort: AbortController;
      dispose?: Dispose;
    }
  | { kind: "failed"; target: HTMLElement };

export type ContributionRecord = {
  key: string;
  extensionID: string;
  order: number;
  mount: Mount;
  state: MountState;
  anchor?: string;
  placement?: "before" | "after";
};

export type Mounter = ReturnType<typeof createMounter>;

export function createMounter(doc: Document, report: Report) {
  const unmount = (record: ContributionRecord) => {
    if (record.state.kind !== "mounted") {
      record.state = { kind: "unmounted" };
      return;
    }
    record.state.abort.abort();
    try {
      record.state.dispose?.();
    } catch (error) {
      report(error, record.extensionID);
    }
    record.state.slot.remove();
    record.state = { kind: "unmounted" };
  };

  const mount = (
    record: ContributionRecord,
    target: HTMLElement,
    attributes: Record<string, string>,
    before: ChildNode | null = null,
  ) => {
    if (record.state.kind === "mounted") {
      const slot = record.state.slot;
      const placed =
        before === null || before === slot || slot.nextSibling === before;
      if (slot.parentElement === target && placed) return;
    }
    // A contribution that threw stays down until its target element changes.
    if (record.state.kind === "failed" && record.state.target === target)
      return;
    unmount(record);
    const slot = doc.createElement("div");
    const abort = new AbortController();
    Object.entries(attributes).forEach(([key, value]) =>
      slot.setAttribute(key, value),
    );
    slot.dataset.opencodeModSlot = record.key;
    slot.style.order = `${record.order}`;
    target.insertBefore(slot, before);
    try {
      const dispose = record.mount(slot, { signal: abort.signal });
      record.state = {
        kind: "mounted",
        slot,
        abort,
        dispose: typeof dispose === "function" ? dispose : undefined,
      };
    } catch (error) {
      abort.abort();
      slot.remove();
      record.state = { kind: "failed", target };
      report(error, record.extensionID);
    }
  };

  return { mount, unmount };
}
