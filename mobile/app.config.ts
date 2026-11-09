import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Dynamic part of the Expo config; everything static lives in app.json (docs/INSTALL.md, 2.3).
 *
 * - EAS project: `eas init` gives a project id, read from app.json (`extra.eas.projectId`) or from
 *   EAS_PROJECT_ID. With it, `eas update` is enabled (https://u.expo.dev/<id>); the channel comes
 *   from the build profile in eas.json, the runtime version from the app version.
 * - EXPO_OWNER: the Expo account or organization that owns the project (optional).
 * - IOS_DEFAULT_BROWSER=1: only once Apple has granted `com.apple.developer.web-browser` to the
 *   bundle id; before that, a provisioning profile with this entitlement cannot be created.
 * - Content blocker (ADR-051): the local module `modules/content-blocker` is autolinked; its config
 *   plugin checks at prebuild that the lists are built and react-native-webview is patched.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = (config.extra?.eas as { projectId?: string } | undefined)?.projectId ?? process.env.EAS_PROJECT_ID;
  const defaultBrowser = process.env.IOS_DEFAULT_BROWSER === "1";
  return {
    ...config,
    name: config.name ?? "Browser",
    slug: config.slug ?? "browser-mobile",
    ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
    plugins: [...(config.plugins ?? []), "./modules/content-blocker/app.plugin.js"],
    updates: projectId ? { url: `https://u.expo.dev/${projectId}`, enabled: true, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 } : { enabled: false },
    ios: {
      ...config.ios,
      ...(defaultBrowser
        ? {
            entitlements: { ...config.ios?.entitlements, "com.apple.developer.web-browser": true },
            infoPlist: {
              ...config.ios?.infoPlist,
              // Required by Apple for a default browser: the app declares it opens http and https
              // (setting the key replaces what Expo derives from `scheme`, so that one is repeated).
              CFBundleURLTypes: [{ CFBundleURLSchemes: ["http", "https"] }, { CFBundleURLSchemes: [String(config.scheme ?? "browser-mobile")] }],
            },
          }
        : {}),
    },
    extra: { ...config.extra, eas: { ...(config.extra?.eas as object | undefined), ...(projectId ? { projectId } : {}) } },
  };
};
