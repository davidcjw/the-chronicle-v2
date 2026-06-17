export function isEligible(plugin, disabledSet, env = process.env) {
  if (disabledSet.has(plugin.id)) return { ok: false, reason: "disabled" };
  const missing = (plugin.env || []).filter((k) => !env[k]);
  if (missing.length) return { ok: false, reason: `missing env: ${missing.join(", ")}` };
  return { ok: true };
}
