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

// Saves settings, waits for the server to re-fork, then reloads.
export async function saveAndRestart(payload, onStatus) {
  onStatus?.("Saving & restarting…");
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("/api/plugins", { cache: "no-store" })).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  location.reload();
}
