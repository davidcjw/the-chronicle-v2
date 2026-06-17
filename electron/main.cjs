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
let authPending = false; // set when an OAuth flow was sent to the external browser

// Persist settings + tokens in the per-user app data dir, not inside the bundle.
process.env.CHRONICLE_DATA_DIR = app.getPath("userData");

// Google blocks OAuth in user-agents it recognises as embedded webviews. Strip the
// "Electron" token so the in-app sign-in window presents as plain Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/[\d.]+/, "");

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

  // Google (and most providers) refuse OAuth inside embedded windows, so consent
  // MUST happen in the user's real browser. The embedded server still catches the
  // localhost callback regardless of which browser completed sign-in. We flag the
  // pending auth so we can refresh the dashboard when the user returns to the app.
  const startExternalAuth = (url) => {
    authPending = true;
    shell.openExternal(url);
  };

  // window.open('/auth/google') from the Settings / walkthrough "Connect" button.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    startExternalAuth(url);
    return { action: "deny" };
  });

  // The calendar widget's "Connect →" is a plain <a href="/auth/google"> that would
  // otherwise navigate the dashboard away. Intercept and send it to the browser too.
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(`http://localhost:${serverPort}/auth/`)) {
      e.preventDefault();
      startExternalAuth(url);
    }
  });

  // When the user comes back from the browser after approving, refresh so the newly
  // connected widget loads — unless the first-run walkthrough is open (reloading
  // would wipe it; that path detects the connection by polling instead).
  mainWindow.on("focus", async () => {
    if (!authPending) return;
    authPending = false;
    const inWalkthrough = await mainWindow.webContents
      .executeJavaScript("!!document.getElementById('ob-overlay')")
      .catch(() => false);
    if (!inWalkthrough) mainWindow.loadURL(appURL());
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
