const path = require('path');
const os = require('os');
const fs = require('fs');

const documentsDir = path.join(os.homedir(), 'Documents');
const hasIcon = fs.existsSync(path.join(__dirname, 'assets', 'icon.png'));

module.exports = {
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
    target: 'nsis',
    ...(hasIcon && { icon: 'assets/icon.png' }),
  },
  linux: {
    target: 'AppImage',
    ...(hasIcon && { icon: 'assets/icon.png' }),
  },
};
