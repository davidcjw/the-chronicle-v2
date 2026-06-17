// First-run walkthrough. Shows once (until `onboarded` is set), framing the app
// and letting the user pick widgets + paste any keys before they ever see the
// gear menu. Reuses the shared form logic from settingsForm.js.
import { el, pluginFields, collect, saveAndRestart, googleConnectControl } from "./settingsForm.js";

let state = null;
let wrap = null;

function setStatus(msg) {
  const s = document.getElementById("ob-status");
  if (s) s.textContent = msg;
}

function finish(payload) {
  saveAndRestart({ ...payload, onboarded: true }, setStatus);
}

// One selectable plugin card: a checkbox that reveals the plugin's fields.
function card(p) {
  const wanted = !(state.config.disabled || []).includes(p.id);
  const check = el("input", { type: "checkbox", "data-toggle": p.id });
  check.checked = wanted;

  const needsKey = p.secrets.length > 0;
  const connectEls = p.connect ? googleConnectControl(p, state, { reloadOnDone: false }) : [];
  const body = el("div", { class: "ob-card-body" }, [...pluginFields(p, state), ...connectEls]);

  const section = el("div", { class: `ob-card${wanted ? " open" : ""}` }, [
    el("label", { class: "ob-card-head" }, [
      check,
      el("div", { class: "ob-card-title" }, [
        el("span", { class: "ob-card-name" }, [
          p.label,
          p.macOnly ? el("span", { class: "set-tag" }, "macOS") : null,
          needsKey ? el("span", { class: "set-tag" }, "needs sign-in") : null,
        ]),
        el("span", { class: "ob-card-blurb" }, p.blurb || ""),
      ]),
    ]),
    body,
  ]);

  check.addEventListener("change", () => section.classList.toggle("open", check.checked));
  return section;
}

function renderWelcome() {
  wrap.replaceChildren(
    el("div", { class: "ob-welcome" }, [
      el("div", { class: "ob-mark" }, "✦"),
      el("h1", {}, "Welcome to The Chronicle"),
      el(
        "p",
        { class: "ob-lede" },
        "Your personal quest log — calendar, tasks, reminders and news, all in one place. Let's pick what you'd like to see. You can change everything later from ⚙ Settings."
      ),
      el("button", { class: "ob-primary", onclick: renderSetup }, "Get started →"),
    ])
  );
}

function renderSetup() {
  const cards = el("div", { class: "ob-cards" }, state.schema.map(card));
  wrap.replaceChildren(
    el("div", { class: "ob-setup" }, [
      el("h2", {}, "Choose your widgets"),
      el(
        "p",
        { class: "ob-sub" },
        "Tick what you want. Items marked “needs sign-in” will prompt you to connect right on the dashboard after setup."
      ),
      cards,
      el("footer", { class: "ob-foot" }, [
        el("button", { class: "ob-ghost", onclick: () => finish({}) }, "Skip for now"),
        el("span", { id: "ob-status" }, ""),
        el(
          "button",
          { class: "ob-primary", onclick: () => finish(collect(cards, state)) },
          "Finish setup"
        ),
      ]),
    ])
  );
}

function launch(s) {
  if (document.getElementById("ob-overlay")) return; // already open
  state = s;
  const overlay = el("div", { id: "ob-overlay" });
  wrap = el("div", { class: "ob-wrap" });
  overlay.append(wrap);
  document.body.append(overlay);
  renderWelcome();
}

// Re-run the walkthrough on demand (e.g. from Settings) without a server restart.
export async function openOnboarding() {
  try {
    launch(await fetch("/api/settings").then((r) => r.json()));
  } catch {
    /* server not ready — ignore */
  }
}

// First-run auto-trigger: only show until the user has been onboarded once.
async function start() {
  let s;
  try {
    s = await fetch("/api/settings").then((r) => r.json());
  } catch {
    return; // server not ready / offline — skip rather than block
  }
  if (!s.onboarded) launch(s);
}

start();
