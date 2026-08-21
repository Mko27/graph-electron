const path = require('path');
const os = require('os');
const fs = require('fs');

const documentsDir = path.join(os.homedir(), 'Documents');
const hasIcon = fs.existsSync(path.join(__dirname, 'assets', 'icon.png'));

module.exports = {
  // Must stay stable across releases: Windows keys the installed product (and
  // therefore its uninstall entry) off this. Changing it orphans the previous
  // version's uninstaller and leaves a dead Add/Remove Programs entry behind.
  appId: 'com.graphclient.app',
  productName: 'Graph Client',
  directories: {
    output: documentsDir,
  },
  files: [
    'apps/electron/dist/**/*',
    'apps/renderer/src/index.html',
    'apps/renderer/src/styles.css',
    'apps/renderer/dist/bundle.js',
    'apps/renderer/dist/bundle.js.map',
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
    deleteAppDataOnUninstall: true,
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
