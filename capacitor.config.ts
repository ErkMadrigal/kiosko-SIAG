import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.skynet.kiosko',
  appName: 'Kiosko SIAG',
  webDir: 'www',
  server: {
    androidScheme: 'http', // ← cambiar de https a http
  },
  plugins: {
    Camera: {
      presentationStyle: 'fullscreen',
    },
  },
};
export default config;
