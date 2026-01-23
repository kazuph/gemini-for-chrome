import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Gemini Side Panel Client',
  version: '1.0.0',
  description: 'A side panel Chrome extension powered by Gemini 2.0 Flash (or compatible models).',
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
  host_permissions: ['<all_urls>'],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Open Gemini Chat',
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
