import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const distSrcDir = path.join(distDir, "src");

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(distSrcDir, { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), distSrcDir, { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(distDir, "index.html"));

console.log("已同步前端文件到 dist/");
