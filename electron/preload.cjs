// Intentionally minimal. The renderer talks to the embedded server over HTTP on
// its own origin (localhost), so no privileged IPC surface is needed. Kept as an
// explicit, locked-down boundary with contextIsolation enabled.
