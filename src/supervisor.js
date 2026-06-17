// Keeps the server alive across settings-driven restarts in browser/dev mode.
// The Electron shell has its own equivalent loop in electron/main.js.
import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const RESTART_CODE = 86;

function start() {
  const child = fork(SERVER, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code === RESTART_CODE) {
      console.log("[supervisor] settings changed — restarting server…");
      start();
    } else {
      process.exit(code ?? 0);
    }
  });
}

start();
