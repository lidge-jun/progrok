import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "node",
    target: "node18",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: {
      app: "src/web/client/app.ts",
      "pcm-worklet": "src/web/client/pcm-worklet.ts",
    },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    outDir: "dist/public/assets",
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: false,
  },
]);
