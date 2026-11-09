/**
 * Config plugin of the content blocker (ADR-051), registered in app.config.ts. At prebuild (local or
 * on EAS) it makes sure the native build will really block, instead of shipping a silent no-op:
 *
 * - the generated lists exist (else `scripts/build-blocklists.mjs` builds them: download, or the
 *   seed list offline) — the iOS pod and the Android library bundle them from the module's folder;
 * - react-native-webview carries the patch (`patches/`, applied by patch-package at postinstall)
 *   that lets the module reach its WebViews: prebuild fails with a clear message otherwise (a
 *   react-native-webview upgrade whose patch did not apply).
 *
 * Nothing is written into the generated native projects: the local module is autolinked like any
 * Expo module (`modules/`), so `android/` and `ios/` stay disposable (`expo prebuild --clean`).
 */
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const MOBILE = path.resolve(__dirname, "../..");
const WEBVIEW = path.dirname(require.resolve("react-native-webview/package.json", { paths: [MOBILE] }));
const PATCH_MARKERS = {
  android: ["android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java", "requestInterceptor"],
  ios: ["apple/RNCWebViewImpl.m", "RNCWebViewDidCreateUserContentController"],
};
const OUTPUTS = {
  android: path.join(__dirname, "android/src/main/assets/blocklists/network.json"),
  ios: path.join(__dirname, "ios/Blocklists/webkit-0.json"),
};

function ensure(platform) {
  const [file, marker] = PATCH_MARKERS[platform];
  if (!readFileSync(path.join(WEBVIEW, file), "utf8").includes(marker)) {
    throw new Error(
      `[content-blocker] react-native-webview is not patched (${file}): run \`npx patch-package\` in mobile/, or update patches/ after a react-native-webview upgrade (docs/DECISIONS.md, ADR-051).`,
    );
  }
  if (!existsSync(OUTPUTS[platform])) {
    execFileSync(process.execPath, [path.join(MOBILE, "scripts/build-blocklists.mjs")], { stdio: "inherit" });
  }
}

module.exports = function withContentBlocker(config) {
  config = withDangerousMod(config, ["android", (mod) => (ensure("android"), mod)]);
  return withDangerousMod(config, ["ios", (mod) => (ensure("ios"), mod)]);
};
