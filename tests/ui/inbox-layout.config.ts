import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./firebase.stub.ts', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  optimizeDeps: { entries: ['inbox-layout.html'] },
  plugins: [react(), tailwindcss()],
  resolve: { alias: [{ find: '../firebase', replacement: stub }, { find: 'firebase/firestore', replacement: stub }] },
  server: { host: '127.0.0.1', port: 4178, strictPort: true, watch: { ignored: ['**/google-cloud-sdk*/**'] } },
});
