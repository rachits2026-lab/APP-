import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The microphone only works on https or localhost. To open the dev server from
// a phone on the same network, start it with HTTPS=1 to get a self-signed cert.
export default defineConfig({
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  build: { target: 'es2022' },
});
