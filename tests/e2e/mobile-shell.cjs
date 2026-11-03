// Phone-sized window for the mobile app's web build (mobile-screenshots.spec.ts): 390×844 unless
// MOBILE_WIDTH/MOBILE_HEIGHT say otherwise (store sizes; the pixel ratio comes from
// --force-device-scale-factor), the color scheme forced by MOBILE_THEME. Not part of the browser;
// only used to take screenshots.
const { app, BrowserWindow, nativeTheme } = require("electron");

app.whenReady().then(() => {
  nativeTheme.themeSource = process.env.MOBILE_THEME === "light" ? "light" : "dark";
  const width = Number(process.env.MOBILE_WIDTH) || 390;
  const height = Number(process.env.MOBILE_HEIGHT) || 844;
  const window = new BrowserWindow({ x: 0, y: 0, width, height, useContentSize: true, frame: false, webPreferences: { sandbox: true } });
  window.loadURL(process.env.MOBILE_URL);
});
