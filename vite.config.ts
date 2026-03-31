import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/** tldraw defaults IndexedDB persist throttle to 350ms; shorten for near-immediate auto-save. */
const TLDRAW_PERSIST_THROTTLE_MS = 50;

/**
 * TldrawUiButtonPicker passes `undefined` for ToggleGroup `value` when selection is mixed,
 * then a string when unified — React warns about switching controlled ↔ uncontrolled.
 * Empty string matches no style token and keeps the group controlled. See tldraw TldrawUiButtonPicker.
 */
function tldrawToggleGroupControlledFixPlugin(): Plugin {
  const needle =
    'value: value.type === "shared" ? value.value : void 0';
  const replacement =
    'value: value.type === "shared" ? value.value : ""';
  return {
    name: "tldraw-toggle-group-controlled-fix",
    transform(code, id) {
      if (!id.includes("TldrawUiButtonPicker")) return null;
      if (!code.includes(needle)) return null;
      const patched = code.replace(needle, replacement);
      return patched === code ? null : patched;
    },
  };
}

function tldrawFastPersistPlugin(ms: number): Plugin {
  return {
    name: "tldraw-fast-persist",
    transform(code, id) {
      if (!id.includes("TLLocalSyncClient")) return null;
      if (!code.includes("PERSIST_THROTTLE_MS")) return null;
      const patched = code.replace(
        /const PERSIST_THROTTLE_MS = \d+/,
        `const PERSIST_THROTTLE_MS = ${ms}`,
      );
      return patched === code ? null : patched;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tldrawFastPersistPlugin(TLDRAW_PERSIST_THROTTLE_MS),
    tldrawToggleGroupControlledFixPlugin(),
  ],
  resolve: {
    alias: {
      "@shared": resolve(rootDir, "src/shared"),
      "@storage": resolve(rootDir, "src/storage")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(rootDir, "src/sidepanel/index.html"),
        canvasTab: resolve(rootDir, "src/tldraw/index.html"),
        background: resolve(rootDir, "src/background/service-worker.ts"),
        content: resolve(rootDir, "src/content/content-script.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
