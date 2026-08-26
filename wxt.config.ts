import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Not the default `.output`: a dot-prefixed directory is hidden in Finder and
  // in Chrome's "Load unpacked" folder picker, which makes installing needlessly
  // hard every time.
  outDir: 'dist',
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'QA Test Case Recorder',
    description:
      'Record test cases with XPath + accessible names, generate automation scripts, and catch bugs as they happen.',
    permissions: [
      'storage',
      // The library can reach ~18 MB at the 500-case cap; the default local
      // storage quota is 10 MB. This permission adds no install-time warning.
      'unlimitedStorage',
      'tabs',
      'scripting',
      'contextMenus',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'QA Test Case Recorder',
    },
  },
});
