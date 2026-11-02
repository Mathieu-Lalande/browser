// Phone-sized window for the mobile app's web build (mobile-screenshots.spec.ts): 390×844, the
// color scheme forced by MOBILE_THEME. Not part of the browser; only used to take screenshots.
const { app, BrowserWindow, nativeTheme } = require("electron");

app.whenReady().then(() => {
  nativeTheme.themeSource = process.env.MOBILE_THEME === "light" ? "light" : "dark";
  const window = new BrowserWindow({ x: 0, y: 0, width: 390, height: 844, useContentSize: true, frame: false, webPreferences: { sandbox: true } });
  window.loadURL(process.env.MOBILE_URL);
});
