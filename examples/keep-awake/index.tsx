import { defineExtension } from "@hona/ocdx";
import type mainExtension from "./main";

export default defineExtension({
  activate(ocdx) {
    const enabled = ocdx.state.boolean("enabled", false);
    const main = ocdx.main<typeof mainExtension>();
    let pending = Promise.resolve();
    const synchronize = (value: boolean) => {
      pending = pending
        .catch(() => undefined)
        .then(async () => {
          const actual = await main.setEnabled(value);
          if (enabled.get() === value && actual !== value) enabled.set(actual);
        });
      void pending.catch((error) => console.error("[keep-awake]", error));
    };

    synchronize(enabled.get());
    ocdx.lifecycle.own(enabled.subscribe(synchronize));
    ocdx.desktop.titlebar.toggle({
      id: "toggle",
      label: "Keep display awake",
      checked: enabled,
      icon: (active) => (active ? <CoffeeIcon /> : <SleepIcon />),
    });
  },
});

function CoffeeIcon() {
  return (
    <svg
      data-slot="icon-svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M3 6.5H11V9.5C11 11.43 9.43 13 7.5 13H6.5C4.57 13 3 11.43 3 9.5V6.5Z" stroke="currentColor" />
      <path d="M11 7.5H12C12.83 7.5 13.5 8.17 13.5 9C13.5 9.83 12.83 10.5 12 10.5H10.85" stroke="currentColor" />
      <path d="M5 4.5C5 3.75 5.75 3.75 5.75 3C5.75 2.5 5.5 2.17 5.25 2" stroke="currentColor" stroke-linecap="round" />
      <path d="M8 4.5C8 3.75 8.75 3.75 8.75 3C8.75 2.5 8.5 2.17 8.25 2" stroke="currentColor" stroke-linecap="round" />
    </svg>
  );
}

function SleepIcon() {
  return (
    <svg
      data-slot="icon-svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M8.75 2.5C6.13 2.5 4 4.63 4 7.25C4 9.87 6.13 12 8.75 12C10.35 12 11.77 11.21 12.63 10C12.21 10.16 11.75 10.25 11.28 10.25C9.07 10.25 7.28 8.46 7.28 6.25C7.28 4.72 8.14 3.39 9.4 2.72C9.19 2.58 8.97 2.5 8.75 2.5Z" stroke="currentColor" stroke-linejoin="round" />
      <path d="M10.5 3H13L10.5 5.5H13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12 6.5H14L12 8.5H14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
