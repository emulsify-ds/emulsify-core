/* eslint-disable */

import yml from '@modyfi/vite-plugin-yaml';
import { globSync } from 'glob';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import twig from 'vite-plugin-twig-drupal';
// import { viteStaticCopy } from "vite-plugin-static-copy";
// import checker from "vite-plugin-checker";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // checker({
    //   eslint: {
    //     lintCommand: 'eslint "./src/components/**/*.{js,jsx}"',
    //   },
    //   stylelint: {
    //     lintCommand: 'stylelint "./src/**/*.css"',
    //   },
    // }),
    // viteStaticCopy({
    //   targets: [
    //     {
    //       src: "./src/components/**/*.{png,jpg,jpeg,svg,webp,mp4}",
    //       dest: "images",
    //     },
    //   ],
    // }),
    twig({
      framework: 'react',
      namespaces: {
        components: join(__dirname, './src/components'),
        layout: join(__dirname, './src/layout'),
        tokens: join(__dirname, './src/tokens'),
      },
    }),
    yml(),
  ],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      input: [
        ...globSync('./src/**/*.js', {
          ignore: './src/**/*.stories.js',
        }),
        ...globSync('./src/**/*.scss', {
          ignore: './src/**/_*.scss',
        }),
      ],
      output: {
        assetFileNames: 'css/[name].css',
        entryFileNames: 'js/[name].js',
      },
    },
  },
});
