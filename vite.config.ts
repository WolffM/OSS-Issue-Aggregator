import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // The favicon in public/ is for the `vite dev` harness only. This bundle is
    // a library mounted into hadoku.me, which serves its own favicon from the
    // site root — so copying public/ into dist/ would ship a stray 14 kB asset
    // in the published package and nothing would ever read it.
    copyPublicDir: false,
    lib: {
      entry: 'src/entry.tsx',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // Externalize peer dependencies (parent provides them via its import
      // map). @wolffm/task-ui-components MUST be external: HadokuThemeRoot
      // (from the mapped @wolffm/themes) provides theme context through the
      // parent's shared ui-components module, and an inlined copy here reads
      // a different context instance — AppHeader then throws "No
      // <HadokuThemeRoot> above this component" (2026-08-05 outage).
      // logger/client and prefs-client are likewise parent-shared singletons.
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@wolffm/themes',
        '@wolffm/task-ui-components',
        '@wolffm/logger/client',
        '@wolffm/prefs-client',
        '@wolffm/prefs-client/react',
        // zod is in the parent's import map too, and reaches this bundle via
        // src/prefs/aggregatorPrefs.ts. Not a singleton — a second copy is
        // weight, not a broken context — but weight for nothing:
        // @wolffm/themes imports zod BARE from its themePrefs.js, so the page
        // fetches esm.sh/zod whether or not this bundle carries a copy.
        // Verified on the live site 2026-08-18. The rule is mechanical:
        // anything the import map provides that you import belongs here.
        'zod'
      ],
      output: {
        assetFileNames: 'style.css'
      }
    },
    target: 'es2022',
    minify: 'esbuild',
    cssCodeSplit: false
  }
})
