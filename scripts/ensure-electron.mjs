// Electron 44 no longer downloads its binary at `npm install`: it does so lazily, the first time
// `electron` is required. electron-vite reads the binary path directly and never triggers that,
// so a fresh clone fails with "Electron uninstall". Run Electron's own installer (a no-op when
// the binary is already there) after every install and before dev/build commands.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const installer = require.resolve("electron/install.js");
const result = spawnSync(process.execPath, [installer], { stdio: "inherit" });
process.exit(result.status ?? 1);
