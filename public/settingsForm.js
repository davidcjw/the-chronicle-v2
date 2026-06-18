// Shared form primitives used by both the Settings drawer (settings.js) and the
// first-run walkthrough (onboarding.js). Single source of truth for how config
// fields, secret inputs, and value collection work.

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

export const listToText = (v) => (Array.isArray(v) ? v.join("\n") : v ?? "");
export const textToList = (t) =>
  t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

export function fieldInput(pluginId, field, value) {
  const id = `cfg-${pluginId}-${field.key}`;
  let input;
  if (field.type === "list") {
    input = el("textarea", { id, rows: 3, "data-type": "list" });
    input.value = listToText(value);
  } else {
    input = el("input", {
      id,
      type: field.type === "number" ? "number" : "text",
      "data-type": field.type,
    });
    input.value = value ?? "";
  }
  input.dataset.plugin = pluginId;
  input.dataset.key = field.key;
  return el("label", { class: "set-field" }, [
    el("span", { class: "set-field-label" }, field.label),
    input,
    field.help ? el("small", { class: "set-help" }, field.help) : null,
  ]);
}

export function secretInput(secret, isSet) {
  const input = el("input", {
    type: "password",
    placeholder: isSet ? "•••••••• (saved — leave blank to keep)" : "Not set",
    autocomplete: "off",
  });
  input.dataset.secret = secret.key;
  return el("label", { class: "set-field" }, [
    el("span", { class: "set-field-label" }, [
      secret.label,
      isSet ? el("span", { class: "set-badge" }, "connected") : null,
    ]),
    input,
    secret.help ? el("small", { class: "set-help" }, secret.help) : null,
  ]);
}

// Renders the secret + config inputs for one plugin (no toggle/header).
export function pluginFields(p, state) {
  return [
    ...p.secrets.map((s) => secretInput(s, state.secretsSet[s.key])),
    ...p.config.map((f) => fieldInput(p.id, f, (state.config[p.id] || {})[f.key])),
  ];
}

// Reads every [data-key] / [data-toggle] / [data-secret] inside `container` and
// produces the { config, secrets } payload expected by POST /api/settings.
export function collect(container, state) {
  const config = {};
  container.querySelectorAll("[data-key]").forEach((inp) => {
    const pid = inp.dataset.plugin;
    config[pid] ||= { ...(state.config[pid] || {}) };
    if (inp.dataset.type === "list") config[pid][inp.dataset.key] = textToList(inp.value);
    else if (inp.dataset.type === "number") config[pid][inp.dataset.key] = Number(inp.value) || 0;
    else config[pid][inp.dataset.key] = inp.value;
  });

  // Toggles / selection checkboxes → the `disabled` array (unchecked = disabled).
  const disabled = [...(state.config.disabled || [])];
  container.querySelectorAll("[data-toggle]").forEach((t) => {
    const id = t.dataset.toggle;
    const i = disabled.indexOf(id);
    if (t.checked && i !== -1) disabled.splice(i, 1);
    if (!t.checked && i === -1) disabled.push(id);
  });
  config.disabled = disabled;

  const secrets = {};
  container.querySelectorAll("[data-secret]").forEach((inp) => {
    if (inp.value.trim()) secrets[inp.dataset.secret] = inp.value.trim();
  });

  return { config, secrets };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function postSettings(payload) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// The current server's boot id (changes on every re-fork), or null if unreachable.
async function currentBoot() {
  try {
    const r = await fetch("/api/plugins", { cache: "no-store" });
    return r.ok ? r.headers.get("X-Chronicle-Boot") : null;
  } catch {
    return null;
  }
}

// Resolves once a *new* server instance is answering. Polling for "any response"
// isn't enough: the old server stays up ~250ms after the save POST, so we'd reload
// against stale config. Waiting for a different boot id avoids that race.
export async function waitForRestart(prevBoot) {
  for (let i = 0; i < 60; i++) {
    const boot = await currentBoot();
    if (boot && boot !== prevBoot) return true;
    await sleep(500);
  }
  return false;
}

// Saves settings, waits for the server to actually re-fork, then reloads.
export async function saveAndRestart(payload, onStatus) {
  onStatus?.("Saving & restarting…");
  const before = await currentBoot();
  await postSettings(payload);
  await waitForRestart(before);
  location.reload();
}

// The calendar API returns 200 only once Google auth has completed.
async function googleConnected() {
  try {
    return (await fetch("/api/events", { cache: "no-store" })).status === 200;
  } catch {
    return false;
  }
}

// Full "Connect Google" flow, usable from the walkthrough or Settings:
// 1. if the user typed fresh creds, save them — this re-forks the server so the
//    calendar's /auth/google routes actually register
// 2. open Google sign-in (the embedded server catches the localhost callback)
// 3. poll until the calendar API authenticates, then optionally reload
async function connectGoogle(card, state, { reloadOnDone }, onStatus) {
  const id = card?.querySelector('[data-secret="GOOGLE_CLIENT_ID"]')?.value.trim();
  const secret = card?.querySelector('[data-secret="GOOGLE_CLIENT_SECRET"]')?.value.trim();
  const hasNew = id && secret;

  if (!hasNew && !state.secretsSet.GOOGLE_CLIENT_ID) {
    onStatus("Enter your Google Client ID and Secret above first.");
    return;
  }
  if (hasNew) {
    onStatus("Saving keys & restarting…");
    const before = await currentBoot();
    await postSettings({ secrets: { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } });
    await waitForRestart(before);
    state.secretsSet.GOOGLE_CLIENT_ID = true;
    state.secretsSet.GOOGLE_CLIENT_SECRET = true;
  }

  onStatus("Opening Google sign-in…");
  const popup = window.open("/auth/google", "_blank", "width=520,height=720");

  onStatus("Waiting for you to approve in Google…");
  for (let i = 0; i < 45; i++) {
    if (await googleConnected()) {
      onStatus("✓ Connected to Google");
      try {
        popup && popup.close();
      } catch {}
      if (reloadOnDone) setTimeout(() => location.reload(), 900);
      return;
    }
    await sleep(1500);
  }
  onStatus("Didn't detect a connection yet — finish in Google, then click again.");
}

// Returns [button, statusLine] wired to the connect flow. The plugin card is
// resolved at click time so it picks up freshly-typed credentials.
export function googleConnectControl(plugin, state, opts = {}) {
  const status = el("small", { class: "set-connect-status" }, "");
  const btn = el(
    "button",
    {
      class: "set-connect",
      onclick: (e) =>
        connectGoogle(
          e.target.closest(".set-plugin, .ob-card"),
          state,
          opts,
          (m) => (status.textContent = m)
        ),
    },
    plugin.connect.label
  );
  return [btn, status];
}
