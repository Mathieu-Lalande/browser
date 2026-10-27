// Metro config: the app reuses the desktop's pure TypeScript modules from ../src/shared
// (imported as `@shared/*`, see tsconfig.json `paths`) instead of copying them.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../src/shared");

const config = getDefaultConfig(projectRoot);

// Let Metro see (and watch) files outside the app folder.
config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName.startsWith("@shared/")) {
    return resolve(context, path.join(sharedRoot, moduleName.slice("@shared/".length)), platform);
  }
  // Packages required from shared files (e.g. Babel runtime helpers injected while transpiling)
  // must come from the app's node_modules, never from the desktop's ../node_modules.
  if (context.originModulePath.startsWith(sharedRoot + path.sep) && !moduleName.startsWith(".") && !path.isAbsolute(moduleName)) {
    return resolve({ ...context, originModulePath: path.join(projectRoot, "index.ts") }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
