// Single source of truth for user-editable settings.
// Replaces v1's dashboard.config.js (config) AND .env (secrets) with one JSON file.
//
// Location:
//   - Electron passes CHRONICLE_DATA_DIR = app.getPath("userData")
//   - Standalone dev falls back to ./data/ in the repo (gitignored)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export function getDataDir() {
  return process.env.CHRONICLE_DATA_DIR || path.join(REPO_ROOT, "data");
}

export function getSettingsPath() {
  return path.join(getDataDir(), "settings.json");
}

// Defaults mirror v1's dashboard.config.js so a fresh install behaves identically.
export const DEFAULT_SETTINGS = {
  port: 3737,
  config: {
    news: {
      topics: ["artificial intelligence", "machine learning", "LLM", "OpenAI"],
      feeds: [],
      maxArticles: 10,
    },
    calendar: { calendarIds: ["primary"] },
    notion: {
      excludeStatuses: ["Done", "Complete"],
      maxTasks: 20,
      properties: { dueDate: "Due Date" },
    },
    gitlab: { maxMRs: 20 },
    standup: { pageId: null },
    "apple-reminders": { lists: [], defaultList: null, maxItems: 20 },
    // Plugins listed here are skipped even if their secrets are set.
    disabled: ["google-tasks", "standup", "gitlab"],
  },
  // Formerly .env — keyed by the env-var name each plugin expects.
  secrets: {
    NOTION_TOKEN: "",
    NOTION_DATABASE_ID: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GITLAB_TOKEN: "",
    GITLAB_URL: "",
  },
};

// Shallow-merge stored settings over defaults so new default keys appear after upgrades.
function merge(defaults, stored) {
  return {
    ...defaults,
    ...stored,
    config: { ...defaults.config, ...(stored.config || {}) },
    secrets: { ...defaults.secrets, ...(stored.secrets || {}) },
  };
}

export function loadSettings() {
  const file = getSettingsPath();
  try {
    if (fs.existsSync(file)) {
      return merge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(file, "utf-8")));
    }
  } catch (err) {
    console.error("[settings] failed to read settings.json, using defaults:", err.message);
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(next) {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const merged = merge(DEFAULT_SETTINGS, next);
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

// Push secrets into process.env so existing plugins (which read process.env) work unchanged.
export function applySecretsToEnv(settings = loadSettings()) {
  for (const [k, v] of Object.entries(settings.secrets || {})) {
    if (v) process.env[k] = v;
  }
}
