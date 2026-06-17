// Compatibility shim: v1 plugins import this file directly.
// In v2 the values come from the user-editable settings store instead of being
// hand-edited here. Evaluated once per server boot; the server re-forks on save,
// so a fresh import always reflects the latest settings.
import { loadSettings } from "./src/settingsStore.js";

export default loadSettings().config;
