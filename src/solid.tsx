import { createSignal, onCleanup, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { ReadonlyCell, Mount } from "./types";

export function mountSolid(view: () => JSX.Element): Mount {
  return (target) => render(view, target);
}

export function useCell<T>(cell: ReadonlyCell<T>) {
  const [value, setValue] = createSignal(cell.get());
  onCleanup(cell.subscribe(setValue));
  return value;
}
