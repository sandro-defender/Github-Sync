/**
 * Entry point of the Ingress panel.
 *
 * Mounts the Preact shell, does the first data load, keeps the UI alive when
 * Home Assistant restarts the container during an update, and re-checks the
 * app version when the tab becomes visible again.
 */
import { html, render } from "./deps.js";
import { api } from "./api.js";
import { refresh } from "./actions.js";
import { status, updates } from "./state.js";
import { Shell } from "./views/app.js";

const container = document.getElementById("app");

render(html`<${Shell} />`, container);

refresh();

/** Quietly refresh the version/update chip when the panel regains focus. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!status.value?.configured) return;
  if (!updates.value?.checked_at) return;
  api("api/updates")
    .then((data) => {
      updates.value = data || {};
    })
    .catch(() => {
      /* offline or restarting — the background checker retries */
    });
});
