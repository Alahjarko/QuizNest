import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const distSrcDir = path.join(distDir, "src");
const distVendorDir = path.join(distDir, "vendor");
const pdfjsBuildDir = path.join(root, "node_modules", "pdfjs-dist", "build");
const jszipDistDir = path.join(root, "node_modules", "jszip", "dist");
const pptxSvgDistDir = path.join(root, "node_modules", "pptx-svg", "dist");
const mathjaxEs5Dir = path.join(root, "node_modules", "mathjax", "es5");

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(distSrcDir, { recursive: true, force: true });
fs.rmSync(distVendorDir, { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), distSrcDir, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
let htmlContent = fs.readFileSync(path.join(root, "index.html"), "utf-8");
htmlContent = htmlContent.replace("</head>", `  <script>window.__APP_VERSION__ = "${pkg.version}";</script>\n</head>`);
fs.writeFileSync(path.join(distDir, "index.html"), htmlContent);

if (fs.existsSync(pdfjsBuildDir)) {
  const pdfjsDistDir = path.join(distVendorDir, "pdfjs");
  fs.mkdirSync(pdfjsDistDir, { recursive: true });
  for (const fileName of ["pdf.mjs", "pdf.worker.mjs"]) {
    fs.copyFileSync(path.join(pdfjsBuildDir, fileName), path.join(pdfjsDistDir, fileName));
  }
}

// jszip 只发 UMD（无 ESM 产物），前端用 <script> 注入后取 window.JSZip，
// 这里把压缩版 vendor 到 dist，与 pdfjs 同级。
if (fs.existsSync(jszipDistDir)) {
  const targetDir = path.join(distVendorDir, "jszip");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(jszipDistDir, "jszip.min.js"), path.join(targetDir, "jszip.min.js"));
}

// pptx-svg：WASM 幻灯片渲染器，ESM 模块 + main.wasm。
// 把 dist/ 中的 .js 和 .wasm 文件 vendor 到 dist/vendor/pptx-svg/，
// 跳过 .d.ts / .map 等开发产物。
if (fs.existsSync(pptxSvgDistDir)) {
  const targetDir = path.join(distVendorDir, "pptx-svg");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(pptxSvgDistDir)) {
    if (entry.endsWith(".js") || entry.endsWith(".wasm")) {
      fs.copyFileSync(path.join(pptxSvgDistDir, entry), path.join(targetDir, entry));
    }
  }
}

// MathJax：本地公式渲染运行时，避免 Tauri WebView 依赖 CDN。
// 运行时优先加载 /vendor/mathjax/tex-svg-full.js；开发环境可回退到 /node_modules。
// 用 full 版而非 tex-svg.js：full 版内置 boldsymbol/ams/physics 等 tex 扩展实现，
// 不依赖 autoload 运行时动态加载扩展文件，避免 Tauri 资源协议路径解析问题。
if (fs.existsSync(mathjaxEs5Dir)) {
  const targetDir = path.join(distVendorDir, "mathjax");
  fs.mkdirSync(targetDir, { recursive: true });
  const fullFile = path.join(mathjaxEs5Dir, "tex-svg-full.js");
  if (fs.existsSync(fullFile)) {
    fs.copyFileSync(fullFile, path.join(targetDir, "tex-svg-full.js"));
  } else {
    fs.copyFileSync(path.join(mathjaxEs5Dir, "tex-svg.js"), path.join(targetDir, "tex-svg.js"));
  }
}

console.log("已同步前端文件到 dist/");
