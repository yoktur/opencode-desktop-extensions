import { defineExtension } from "../../src";
import styles from "./styles.css?inline";

export default defineExtension({
  styles,
  activate(ocdx) {
    ocdx.desktop.titlebar.action({
      id: "proof",
      label: "OCDX live attach is active",
      icon: "status",
      order: -100,
      onPress: () =>
        alert("This OCDX contribution was loaded by a normal OpenCode plugin."),
    });
  },
});
