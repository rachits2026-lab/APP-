import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Relative base so the built app works from any folder or static host.
// "npm run dev:phone" serves https with a self-signed certificate, which a
// phone needs before it will allow the microphone on a local network address.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'phone' ? [basicSsl()] : [],
  build: { target: 'es2022' },
}));
