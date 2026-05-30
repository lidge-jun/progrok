import { cpSync } from "node:fs";

cpSync("src/chat/public", "dist/public", { recursive: true });
console.log("Copied chat UI assets to dist/public/");
