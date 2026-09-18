import { cpSync, rmSync } from "node:fs";

const source = new URL("../src/web/public/", import.meta.url);
const target = new URL("../dist/public/", import.meta.url);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log("Copied web app static assets to dist/public/");
