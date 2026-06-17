// Electron shell: boots the embedded server, shows the dashboard in a window,
// and re-forks the server when settings are saved. Distribution-friendly — the
// user double-clicks the app; no Node, terminal, or npm required.
const { app, BrowserWindow, shell } = require("electron");
const { fork } = require("child_process");
const path = require("path");

const RESTART_CODE = 86;
const SERVER = path.join(__dirname, "..", "src", "server.js");

let mainWindow = null;
let child = null;
let serverPort = 3737;

// Persist settings + tokens in the per-user app data dir, not inside the bundle.
process.env.CHRONICLE_DATA_DIR = app.getPath("userData");

function startServer() {
  return new Promise((resolve) => {
    child = fork(SERVER, {
      stdio: "inherit",
      // cwd = writable data dir so plugins that write relative paths (e.g. the
      // calendar plugin's tokens.json) don't try to write into the read-only bundle.
      cwd: app.getPath("userData"),
      env: { ...process.env, CHRONICLE_DATA_DIR: app.getPath("userData") },
    });
    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        serverPort = msg.port;
        resolve();
      }
    });
    child.on("exit", (code) => {
      child = null;
      if (code === RESTART_CODE) {
        startServer().then(() => mainWindow && mainWindow.loadURL(appURL()));
      }
    });
  });
}

const appURL = () => `http://localhost:${serverPort}/`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "The Chronicle",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(appURL());

  // OAuth "Connect" buttons call window.open('/auth/google'). Open those as a child
  // window (the localhost callback completes inside it); send anything else to the
  // user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${serverPort}`)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 520, height: 700, title: "Connect account" },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // When an OAuth popup lands back on the dashboard root, the flow is done: close it
  // and refresh the main window so the newly-connected widget appears.
  mainWindow.webContents.on("did-create-window", (popup) => {
    popup.webContents.on("did-navigate", (_e, navUrl) => {
      if (navUrl === appURL() || navUrl === appURL().slice(0, -1)) {
        popup.close();
        mainWindow.loadURL(appURL());
      }
    });
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (child) child.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (child) child.kill();
});
