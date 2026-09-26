import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Content scripts run as classic scripts and cannot resolve `import` statements, so the
// content script is built on its own as a single self-contained IIFE. That lets it import
// from ../shared freely without Rollup splitting shared code into a chunk it can't load.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/content/index.ts", import.meta.url)),
      formats: ["iife"],
      name: "zapContent",
      fileName: () => "assets/content.js",
    },
  },
});
