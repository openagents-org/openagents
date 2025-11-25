import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  if (isProduction) {
    return {
      plugins: [react()],
      server: {
        fs: {
          allow: ['..'],
        },
      },
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/index.tsx'),
          name: 'DocumentsModUI',
          fileName: () => `index.js`,
          formats: ['es'],
        },
        rollupOptions: {
          external: [
            'react',
            'react-dom',
            'react-router-dom',
            '@monaco-editor/react',
            'monaco-editor',
            'yjs',
            'y-monaco',
            'y-protocols/awareness',
            'zustand',
            'sonner',
          ],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
              'react-router-dom': 'ReactRouterDOM',
            },
          },
        },
        outDir: 'dist',
        emptyOutDir: true,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        },
      },
    };
  }

  return {
    plugins: [react()],
    server: {
      port: 5177,
      host: true,
      open: true,
      fs: {
        allow: ['..'],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});

