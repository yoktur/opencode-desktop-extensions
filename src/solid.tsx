import { createSignal, onCleanup, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { Cell, Mount } from "./types";

export function mountSolid(view: () => JSX.Element): Mount {
  return (target) => render(view, target);
}

export function useCell<T>(cell: Cell<T>) {
  const [value, setValue] = createSignal(cell.get());
  onCleanup(cell.subscribe(setValue));
  return value;
}
