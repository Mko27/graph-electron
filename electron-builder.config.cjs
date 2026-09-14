const path = require('path');
const os = require('os');
const fs = require('fs');

// Release artifacts go in the project's own release/ directory (gitignored).
// They used to land in the user's ~/Documents, which cannot be gitignored,
// differs per machine and is meaningless on a build server. Override with
// GRAPH_CLIENT_OUTPUT_DIR if you need them elsewhere.
const outputDir = process.env.GRAPH_CLIENT_OUTPUT_DIR || path.join(__dirname, 'release');
const hasIcon = fs.existsSync(path.join(__dirname, 'assets', 'icon.png'));

module.exports = {
  // Must stay stable across releases: Windows keys the installed product (and
  // therefore its uninstall entry) off this. Changing it orphans the previous
  // version's uninstaller and leaves a dead Add/Remove Programs entry behind.
  appId: 'com.graphclient.app',
  productName: 'Graph Client',
  directories: {
    output: outputDir,
  },
  // Electron fuses — flipped in the binary at package time to shrink the
  // attack surface of the shipped app.
  electronFuses: {
    // Refuse to act as a plain Node process (ELECTRON_RUN_AS_NODE), which would
    // otherwise let the shipped binary run arbitrary scripts.
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    // Encrypt cookies at rest with an OS-backed key.
    enableCookieEncryption: true,
    // Validate the asar against a hash embedded in the app, and never load app
    // code from an unpacked directory instead.
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  /**
   * Re-sign after the fuses are flipped.
   *
   * Flipping a fuse rewrites bytes in the Mach-O binary, which invalidates the
   * ad-hoc signature Electron ships with. On Apple Silicon the kernel refuses
   * to run a binary whose signature does not match and SIGKILLs it on launch,
   * so without this the fused app dies instantly (exit 137).
   *
   * Must run in afterSign, not afterPack: afterPack fires BEFORE the fuses are
   * flipped, so a signature applied there is invalidated moments later.
   *
   * When a real Developer ID identity is configured, electron-builder's own
   * signing supersedes this — it only matters for unsigned local/QA builds.
   */
  afterSign: async (context) => {
    if (context.electronPlatformName !== 'darwin') return;

    const { execFileSync } = require('child_process');
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
    );

    try {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
        stdio: 'pipe',
      });
      console.log(`  • ad-hoc re-signed after fuse flip  app=${appPath}`);
    } catch (err) {
      console.warn(
        `  ⚠ ad-hoc re-sign failed — the fused app may not launch: ${err.message}`,
      );
    }
  },
  files: [
    'apps/electron/dist/**/*',
    'apps/renderer/src/index.html',
    'apps/renderer/src/styles.css',
    'apps/renderer/src/fonts.css',
    'apps/renderer/src/fonts/**/*',
    'apps/renderer/dist/bundle.js',
    // bundle.js.map is deliberately NOT shipped: it embeds the full original
    // source of the renderer in the installed app.
    'packages/core/dist/**/*',
    'packages/shared/dist/**/*',
    {
      from: 'packages/core',
      to: 'node_modules/@graph-client/core',
      filter: ['package.json', 'dist/**/*'],
    },
    {
      from: 'packages/shared',
      to: 'node_modules/@graph-client/shared',
      filter: ['package.json', 'dist/**/*'],
    },
    ...(hasIcon ? ['assets/**/*'] : []),
  ],
  mac: {
    target: 'dmg',
    ...(hasIcon && { icon: 'assets/icon.png' }),
    category: 'public.app-category.developer-tools',
    // Gatekeeper rejects an unsigned build as "damaged" on any machine that did
    // not produce it. These switch on as soon as signing credentials exist in
    // the environment (CSC_LINK / CSC_KEY_PASSWORD, plus APPLE_ID +
    // APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID for notarisation); without
    // them the build stays unsigned and local-only, as before.
    hardenedRuntime: Boolean(process.env.CSC_LINK),
    gatekeeperAssess: false,
    ...(process.env.CSC_LINK
      ? { entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist' }
      : {}),
    notarize: Boolean(process.env.APPLE_TEAM_ID) && { teamId: process.env.APPLE_TEAM_ID },
  },
  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...(hasIcon && { icon: 'assets/icon.png' }),
    artifactName: '${productName}-${version}-${arch}-setup.${ext}',
  },
  nsis: {
    // Assisted (non one-click) installer. One-click builds install silently to
    // a per-user path and are the usual source of "the uninstaller doesn't
    // appear / doesn't remove anything" reports, because the uninstall entry
    // and the install scope can end up disagreeing.
    oneClick: false,
    // Per-user install: no elevation, and the uninstall entry is registered
    // under HKCU for the same user that installed it. Keep this fixed —
    // flipping install scope between releases is what strands uninstallers.
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Graph Client',
    // Without an explicit name, the Add/Remove Programs entry is derived and
    // can drift from the installed product name.
    uninstallDisplayName: 'Graph Client ${version}',
    // Remove the app's own data (including the saved workspace) on uninstall,
    // so uninstalling actually leaves the machine clean.
    // Leaving saved connections, tabs and history in place: uninstalling to
    // reinstall (or to upgrade) should not destroy the user's workspace. The
    // data lives in %APPDATA%/graph-client and can be removed by hand.
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    // Uninstall the previous version before laying down the new one, instead of
    // stacking a second registry entry per release.
    differentialPackage: false,
  },
  linux: {
    target: 'AppImage',
    ...(hasIcon && { icon: 'assets/icon.png' }),
  },
};
