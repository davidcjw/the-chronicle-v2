// Settings drawer — lets users pick widgets, fill in config, paste secrets, and
// connect accounts without touching files. Renders generically from the schema
// returned by /api/settings. Shared form logic lives in settingsForm.js.
import { el, pluginFields, collect, saveAndRestart, googleConnectControl } from "./settingsForm.js";
import { openOnboarding } from "./onboarding.js";

let state = null; // { schema, config, secretsSet, plugins }

function pluginSection(p) {
  const status = state.plugins.find((x) => x.id === p.id) || {};
  const active = status.active ?? false;
  const cfg = state.config[p.id] || {};

  const toggle = el("input", { type: "checkbox", "data-toggle": p.id });
  toggle.checked = active;

  const connectEls = p.connect ? googleConnectControl(p, state, { reloadOnDone: true }) : [];

  return el("section", { class: "set-plugin" }, [
    el("div", { class: "set-plugin-head" }, [
      el("label", { class: "set-switch" }, [toggle, el("span", { class: "set-slider" })]),
      el("div", {}, [
        el("h3", {}, [p.label, p.macOnly ? el("span", { class: "set-tag" }, "macOS") : null]),
        el("p", { class: "set-blurb" }, p.blurb || ""),
      ]),
    ]),
    el("div", { class: "set-plugin-body" }, [...pluginFields(p, state), ...connectEls]),
  ]);
}

function buildDrawer() {
  const body = el("div", { id: "set-body" }, state.schema.map(pluginSection));
  const drawer = el("aside", { id: "set-drawer" }, [
    el("header", { class: "set-head" }, [
      el("h2", {}, "Settings"),
      el("button", { class: "set-close", onclick: close, title: "Close" }, "✕"),
    ]),
    body,
    el("footer", { class: "set-foot" }, [
      el(
        "button",
        { class: "set-rerun", onclick: () => { close(); openOnboarding(); } },
        "↺ Run setup again"
      ),
      el("span", { id: "set-status" }, ""),
      el(
        "button",
        {
          class: "set-save",
          onclick: () =>
            saveAndRestart(collect(body, state), (m) => (drawer.querySelector("#set-status").textContent = m)),
        },
        "Save changes"
      ),
    ]),
  ]);
  return drawer;
}

function close() {
  document.getElementById("set-overlay")?.remove();
}

async function open() {
  state = await fetch("/api/settings").then((r) => r.json());
  const overlay = el("div", {
    id: "set-overlay",
    onclick: (e) => e.target.id === "set-overlay" && close(),
  });
  overlay.append(buildDrawer());
  document.body.append(overlay);
}

document.getElementById("settings-btn")?.addEventListener("click", open);

// ⌘, / Ctrl+, — the standard "Preferences" shortcut.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {
    e.preventDefault();
    if (!document.getElementById("set-overlay")) open();
  }
});
