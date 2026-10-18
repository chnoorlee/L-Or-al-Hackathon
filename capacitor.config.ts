import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chnoorlee.eventone',
  appName: '匀色遮瑕',
  webDir: 'dist/web',
  backgroundColor: '#f8f8fc',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
};
export default config;
