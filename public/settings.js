// Settings drawer — lets non-technical users pick widgets, fill in config, paste
// secrets, and connect accounts without touching files. Renders generically from
// the schema returned by /api/settings.

let state = null; // { schema, config, secretsSet, plugins }

function el(tag, attrs = {}, children = []) {
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

const listToText = (v) => (Array.isArray(v) ? v.join("\n") : v ?? "");
const textToList = (t) =>
  t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function fieldInput(pluginId, field, value) {
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

function secretInput(pluginId, secret, isSet) {
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

function pluginSection(p) {
  const status = state.plugins.find((x) => x.id === p.id) || {};
  const active = status.active ?? false;
  const cfg = state.config[p.id] || {};

  const toggle = el("input", { type: "checkbox", "data-toggle": p.id });
  toggle.checked = active;

  const secretsReady = (p.connect?.requires || []).every((k) => state.secretsSet[k]);
  const connectBtn = p.connect
    ? el(
        "button",
        {
          class: "set-connect",
          disabled: secretsReady ? null : "true",
          title: secretsReady ? "" : "Fill in the keys above and save first",
          onclick: () => window.open(p.connect.url, "_blank"),
        },
        p.connect.label
      )
    : null;

  return el("section", { class: "set-plugin" }, [
    el("div", { class: "set-plugin-head" }, [
      el("label", { class: "set-switch" }, [toggle, el("span", { class: "set-slider" })]),
      el("div", {}, [
        el("h3", {}, [p.label, p.macOnly ? el("span", { class: "set-tag" }, "macOS") : null]),
        el("p", { class: "set-blurb" }, p.blurb || ""),
      ]),
    ]),
    el("div", { class: "set-plugin-body" }, [
      ...p.secrets.map((s) => secretInput(p.id, s, state.secretsSet[s.key])),
      ...p.config.map((f) => fieldInput(p.id, f, cfg[f.key])),
      connectBtn,
    ]),
  ]);
}

function collect() {
  const config = {};
  document.querySelectorAll("#set-body [data-key]").forEach((inp) => {
    const pid = inp.dataset.plugin;
    config[pid] ||= { ...(state.config[pid] || {}) };
    if (inp.dataset.type === "list") config[pid][inp.dataset.key] = textToList(inp.value);
    else if (inp.dataset.type === "number") config[pid][inp.dataset.key] = Number(inp.value) || 0;
    else config[pid][inp.dataset.key] = inp.value;
  });

  // Toggles → the `disabled` array.
  const disabled = [...(state.config.disabled || [])];
  document.querySelectorAll("#set-body [data-toggle]").forEach((t) => {
    const id = t.dataset.toggle;
    const i = disabled.indexOf(id);
    if (t.checked && i !== -1) disabled.splice(i, 1);
    if (!t.checked && i === -1) disabled.push(id);
  });
  config.disabled = disabled;

  const secrets = {};
  document.querySelectorAll("#set-body [data-secret]").forEach((inp) => {
    if (inp.value.trim()) secrets[inp.dataset.secret] = inp.value.trim();
  });

  return { config, secrets };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("/api/plugins", { cache: "no-store" });
      if (r.ok) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

async function save(drawer) {
  const status = drawer.querySelector("#set-status");
  status.textContent = "Saving & restarting…";
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collect()),
  });
  await waitForServer();
  location.reload(); // simplest way to re-render widgets with the new config
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
      el("span", { id: "set-status" }, ""),
      el("button", { class: "set-save", onclick: () => save(drawer) }, "Save changes"),
    ]),
  ]);
  return drawer;
}

function close() {
  document.getElementById("set-overlay")?.remove();
}

async function open() {
  state = await fetch("/api/settings").then((r) => r.json());
  const overlay = el("div", { id: "set-overlay", onclick: (e) => e.target.id === "set-overlay" && close() });
  overlay.append(buildDrawer());
  document.body.append(overlay);
}

document.getElementById("settings-btn")?.addEventListener("click", open);
