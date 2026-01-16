import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Job Applier',
  version: '1.0.0',
  description: 'AI-powered LinkedIn job application assistant',
  
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'tabs',
    'debugger',
  ],
  
  host_permissions: [
    'https://www.linkedin.com/*',
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
  ],
  
  action: {
    // No popup - clicking icon opens full page tab
    default_icon: {
      '16': 'public/assets/icon-16.png',
      '48': 'public/assets/icon-48.png',
      '128': 'public/assets/icon-128.png',
    },
    default_title: 'Job Applier',
  },
  
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  
  content_scripts: [
    {
      matches: ['https://www.linkedin.com/*'],
      js: ['src/content/linkedin/index.ts'],
      run_at: 'document_idle',
    },
  ],
  
  icons: {
    '16': 'public/assets/icon-16.png',
    '48': 'public/assets/icon-48.png',
    '128': 'public/assets/icon-128.png',
  },
  
  // Required for Anthropic API calls from extension
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});

