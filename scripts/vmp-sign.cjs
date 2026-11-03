// castLabs EVS VMP signing of the packaged app (ADR-040), for Widevine playback in production
// (Netflix, Disney+… refuse an unsigned build on Windows and macOS). A no-op unless the
// EVS_ACCOUNT_NAME and EVS_PASSWD secrets are set (free account: docs/INSTALL.md), so local and
// CI builds without them stay unsigned. Needs Python 3 with `pip install castlabs-evs`.
//
// Order matters (castLabs):
// - macOS: VMP signature BEFORE the Apple code signature (it lives inside the bundle), but AFTER
//   the Electron fuses, which modify the binary: `afterPack` flips the fuses itself first
//   (electron-builder flips them again to the same values, leaving the bytes unchanged).
// - Windows: VMP signature AFTER Authenticode (`afterSign`), or in `afterPack` when the build is
//   not code-signed (electron-builder skips `afterSign` then).
// - Linux: no VMP (Widevine L3 without it).
const { spawnSync } = require("node:child_process");

const enabled = () => Boolean(process.env.EVS_ACCOUNT_NAME && process.env.EVS_PASSWD);
const python = () => process.env.EVS_PYTHON || (process.platform === "win32" ? "python" : "python3");

function run(args, label) {
  const result = spawnSync(python(), ["-m", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`castLabs EVS : échec de « ${label} » (code ${result.status ?? result.error?.message}).`);
}

let authenticated = false;

function vmpSign(appOutDir) {
  if (!authenticated) {
    // Refreshes the EVS token from the secrets (no interactive prompt on CI).
    run(["castlabs_evs.account", "reauth", "-A", process.env.EVS_ACCOUNT_NAME, "-P", process.env.EVS_PASSWD], "account reauth");
    authenticated = true;
  }
  run(["castlabs_evs.vmp", "sign-pkg", appOutDir], "vmp sign-pkg");
  console.log(`  • VMP signé (castLabs EVS) : ${appOutDir}`);
}

/** Whether electron-builder will code-sign this Windows build (then VMP waits for `afterSign`). */
function windowsCodeSigned(context) {
  const win = context.packager.platformSpecificBuildOptions || {};
  return Boolean(win.azureSignOptions || process.env.WIN_CSC_LINK || process.env.CSC_LINK);
}

async function afterPack(context) {
  if (!enabled()) return;
  if (context.electronPlatformName === "darwin") {
    await context.packager.doAddElectronFuses(context);
    vmpSign(context.appOutDir);
  } else if (context.electronPlatformName === "win32" && !windowsCodeSigned(context)) {
    vmpSign(context.appOutDir);
  }
}

async function afterSign(context) {
  if (!enabled()) return;
  if (context.electronPlatformName === "win32" && windowsCodeSigned(context)) vmpSign(context.appOutDir);
}

module.exports = { afterPack, afterSign, enabled, windowsCodeSigned };
