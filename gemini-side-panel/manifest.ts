import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Gemini Side Panel Client',
  version: '2.1.3',
  description: 'A side panel Chrome extension powered by Gemini (2.0 / 2.5 / 3.x). CDP-powered native input for bot-resistant sites.',
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'debugger'],
  host_permissions: ['<all_urls>'],
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Open Gemini Chat',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
})
