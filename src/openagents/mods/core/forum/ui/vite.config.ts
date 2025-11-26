import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command, mode }) => {
  const isProduction = mode === 'production';
  
  // Production build: library mode for dynamic loading
  if (isProduction) {
    return {
      plugins: [react()],
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/index.tsx'),
          name: 'ForumModUI',
          fileName: () => `index.js`,
          formats: ['es'],
        },
        rollupOptions: {
          external: [
            'react',
            'react-dom',
            'react-router-dom',
            'react-markdown',
            'remark-gfm',
            'rehype-highlight',
            'rehype-raw',
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
  
  // Development mode: application mode
  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: true,
      open: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});

