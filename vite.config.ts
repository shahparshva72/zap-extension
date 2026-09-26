import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    // dist is cleared by the npm scripts so this build doesn't wipe the content script
    // produced by vite.content.config.ts.
    emptyOutDir: false,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./popup.html", import.meta.url)),
        manage: fileURLToPath(new URL("./manage.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background/index.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
