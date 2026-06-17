// Embedded Express server. Runs identically whether forked by the Electron shell
// or by src/supervisor.js for browser-based dev. Config + secrets come from the
// settings store, not from dashboard.config.js edits or a .env file.
import express from "express";
import { readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { isEligible } from "./lib/pluginUtils.js";
import { loadSettings, saveSettings, applySecretsToEnv } from "./settingsStore.js";
import { SETTINGS_SCHEMA } from "./settingsSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RESTART_CODE = 86; // supervisor/Electron re-fork on this exit code

const settings = loadSettings();
applySecretsToEnv(settings); // must run before any plugin is imported
const disabledPlugins = new Set(settings.config.disabled || []);

const app = express();
const PORT = settings.port || process.env.PORT || 3737;

app.use(express.json());
app.use(express.static(path.join(REPO_ROOT, "public")));

const activePlugins = [];
const allPlugins = []; // every discovered plugin + why it is / isn't active

async function loadPlugins() {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const entries = await readdir(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const { default: plugin } = await import(`../plugins/${entry.name}/index.js`);
      const { ok, reason } = isEligible(plugin, disabledPlugins);
      allPlugins.push({ id: plugin.id, label: plugin.label, active: ok, reason: reason || "" });

      if (!ok) {
        console.log(`[${plugin.id}] Skipped — ${reason}`);
        continue;
      }
      for (const route of plugin.routes || []) {
        app[route.method.toLowerCase()](route.path, route.handler);
      }
      if (typeof plugin.onLoad === "function") await plugin.onLoad();
      activePlugins.push({ id: plugin.id, label: plugin.label });
      console.log(`[${plugin.id}] Loaded ✓`);
    } catch (err) {
      console.error(`Failed to load plugin ${entry.name}:`, err.message);
    }
  }
}

// Frontend asks which widgets to render.
app.get("/api/plugins", (req, res) => res.json(activePlugins));

// Settings UI: current values + schema + per-plugin status. Secrets are returned
// only as booleans ("is it set?") — never the raw values.
app.get("/api/settings", (req, res) => {
  const s = loadSettings();
  const secretsSet = Object.fromEntries(
    Object.entries(s.secrets).map(([k, v]) => [k, Boolean(v)])
  );
  res.json({
    schema: SETTINGS_SCHEMA,
    config: s.config,
    secretsSet,
    plugins: allPlugins,
    onboarded: s.onboarded,
  });
});

// Save settings, then exit with RESTART_CODE so the supervisor re-forks with fresh
// config/secrets. The renderer polls /api/plugins to know when we're back.
app.post("/api/settings", (req, res) => {
  try {
    const current = loadSettings();
    const body = req.body || {};
    // Only overwrite a secret if a non-empty value was provided (blank = keep existing).
    const secrets = { ...current.secrets };
    for (const [k, v] of Object.entries(body.secrets || {})) {
      if (typeof v === "string" && v.trim() !== "") secrets[k] = v.trim();
    }
    saveSettings({
      ...current,
      onboarded: body.onboarded ?? current.onboarded,
      config: { ...current.config, ...(body.config || {}) },
      secrets,
    });
    res.json({ ok: true, restarting: true });
    setTimeout(() => process.exit(RESTART_CODE), 250);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

await loadPlugins();

app.listen(PORT, () => {
  console.log(`\nThe Chronicle → http://localhost:${PORT}\n`);
  if (process.send) process.send({ type: "ready", port: PORT });
});
