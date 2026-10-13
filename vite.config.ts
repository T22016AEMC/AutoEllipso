import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {securityHeaders} from './deployment/security.mjs';

export default defineConfig(() => {
  if(Object.keys(process.env).some(key=>/^VITE_PUBLIC_.*(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)))throw new Error('Public environment variables must not contain credentials');
  const commit=process.env.CF_PAGES_COMMIT_SHA??process.env.VERCEL_GIT_COMMIT_SHA??'local';
  const buildTime=new Date().toISOString();
  return {
    base:'/',
    envPrefix:'VITE_PUBLIC_',
    define:{__BUILD_COMMIT__:JSON.stringify(commit),__BUILD_TIME__:JSON.stringify(buildTime)},
    build:{target:['es2022','safari16.4'],sourcemap:false},
    worker:{format:'es' as const},
    preview:{host:'127.0.0.1',headers:securityHeaders},
    plugins: [react(), tailwindcss(),{name:'version-manifest',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({application:'AutoEllipso',version:'2.1.0',commit,buildTime,calculation:'browser-only'},null,2)});}}],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
