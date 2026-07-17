import { defineMainExtension } from "@hona/ocdx/main";
import { powerSaveBlocker } from "electron";

export default defineMainExtension((ocdx) => {
  let blocker: number | undefined;
  const isEnabled = () =>
    blocker !== undefined && powerSaveBlocker.isStarted(blocker);
  const stop = () => {
    if (blocker === undefined) return;
    if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = undefined;
  };
  ocdx.lifecycle.own(stop);

  return {
    setEnabled(enabled: boolean) {
      if (enabled && !isEnabled()) {
        blocker = powerSaveBlocker.start("prevent-display-sleep");
      } else if (!enabled) {
        stop();
      }
      return isEnabled();
    },
  };
});
