import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const distSrcDir = path.join(distDir, "src");
const distVendorDir = path.join(distDir, "vendor");
const pdfjsBuildDir = path.join(root, "node_modules", "pdfjs-dist", "build");

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(distSrcDir, { recursive: true, force: true });
fs.rmSync(distVendorDir, { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), distSrcDir, { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(distDir, "index.html"));

if (fs.existsSync(pdfjsBuildDir)) {
  const pdfjsDistDir = path.join(distVendorDir, "pdfjs");
  fs.mkdirSync(pdfjsDistDir, { recursive: true });
  for (const fileName of ["pdf.mjs", "pdf.worker.mjs"]) {
    fs.copyFileSync(path.join(pdfjsBuildDir, fileName), path.join(pdfjsDistDir, fileName));
  }
}

console.log("已同步前端文件到 dist/");
