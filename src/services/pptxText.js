// 从 .pptx 文件提取幻灯片内容，提供两种模式：
//
// - extractPptxSlides：用 pptx-svg 把每张幻灯片渲染为完整 PNG 图片（主路径），
//   发给多模态模型直接读图，能识别公式、推导、图解、排版等所有视觉内容。
//   对图片型、文字型、混合型 PPT 都通用，效果远优于纯文本抽取。
//
// - extractPptxText：只抽 <a:t> 文本节点（备用路径，文字型 PPT 可用），
//   与 pdfText.js 返回结构对齐，但无法识别图片中的公式/推导。
//   对图片型 PPT（如截图版课件）只能拿到目录骨架，无实质内容。

const MAX_PPTX_SIZE = 40 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120_000;
const MIN_EXTRACTED_CHARS = 80;
const MAX_SLIDE_IMAGE_WIDTH = 1280;
const MAX_SLIDE_IMAGE_HEIGHT = 960;

let jszipPromise = null;
let pptxSvgPromise = null;

// ===== 主路径：整页渲染为 PNG（多模态模型直接读图） =====

// 用 pptx-svg 渲染每张幻灯片为完整 PNG 图片，保留标题、内容、排版、公式等
// 所有视觉信息。SVG 通过 Canvas API 转 PNG data URL，发给多模态笔记模型。
export async function extractPptxSlides(file) {
  if (!file) throw new Error("请先选择 PowerPoint 文件");
  if (!/\.pptx$/i.test(file.name) && !file.type.includes("presentationml.presentation")) {
    throw new Error("请上传 .pptx 文件");
  }
  if (file.size > MAX_PPTX_SIZE) {
    throw new Error("PPT 超过 40MB，请先压缩或拆分后再导入");
  }

  const { PptxRenderer } = await loadPptxSvg();
  const renderer = new PptxRenderer();
  await renderer.init();
  await renderer.loadPptx(await file.arrayBuffer());

  const slideCount = renderer.getSlideCount();
  if (slideCount === 0) {
    throw new Error("没有在 PPT 中找到幻灯片，文件可能损坏或不是标准 .pptx");
  }

  const slides = [];
  for (let i = 0; i < slideCount; i += 1) {
    const svg = renderer.renderSlideSvg(i);
    const title = extractSlideTitle(svg);
    const dataUrl = await svgToPngDataUrl(svg, MAX_SLIDE_IMAGE_WIDTH, MAX_SLIDE_IMAGE_HEIGHT);
    slides.push({ pageNumber: i + 1, title, dataUrl });
  }

  return {
    fileName: file.name,
    pageCount: slideCount,
    slides,
    imageCount: slideCount
  };
}

// 从 SVG 中提取标题（取第一个文本节点的第一行），作为幻灯片标注
function extractSlideTitle(svg) {
  // SVG 中文本节点由 pptx-svg 渲染的 <text> 元素承载
  // 用简单正则取前几行文字，足够给模型做幻灯片标注
  const textMatches = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
  if (textMatches.length === 0) return "";
  // 只取前 2 行作为简短标题
  return textMatches.slice(0, 2).join(" ").slice(0, 60);
}

// SVG → PNG data URL（浏览器 Canvas API）
// pptx-svg 渲染的 SVG 是自包含的（嵌入图片全为 base64 data URL），
// Canvas 不会被 tainted，toDataURL() 可正常工作。
function svgToPngDataUrl(svgString, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 用 encodeURIComponent 编码 SVG（支持中文等非 Latin-1 字符）
    const svgDataUrl =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    img.onload = () => {
      const scale = Math.min(
        maxWidth / (img.naturalWidth || 960),
        maxHeight / (img.naturalHeight || 540),
        1
      );
      const w = Math.round((img.naturalWidth || 960) * scale);
      const h = Math.round((img.naturalHeight || 540) * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("幻灯片渲染为图片失败"));
    img.src = svgDataUrl;
  });
}

// pptx-svg 是 ESM 模块 + WASM，动态 import 加载。
// 先试 /vendor（dist 打包），回退 /node_modules（dev）。
async function loadPptxSvg() {
  if (pptxSvgPromise) return pptxSvgPromise;
  pptxSvgPromise = (async () => {
    const candidates = [
      "/vendor/pptx-svg/index.js",
      "/node_modules/pptx-svg/dist/index.js"
    ];
    let lastError = null;
    for (const path of candidates) {
      try {
        const module = await import(path);
        return module;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `pptx-svg 渲染库加载失败：${lastError?.message || "未知错误"}`
    );
  })();
  return pptxSvgPromise;
}

// ===== 备用路径：纯文本抽取（与 pdfText.js 对齐） =====

export async function extractPptxText(file) {
  if (!file) throw new Error("请先选择 PowerPoint 文件");
  if (!/\.pptx$/i.test(file.name) && !file.type.includes("presentationml.presentation")) {
    throw new Error("请上传 .pptx 文件");
  }
  if (file.size > MAX_PPTX_SIZE) {
    throw new Error("PPT 超过 40MB，请先压缩或拆分后再导入");
  }

  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));

  if (slideFiles.length === 0) {
    throw new Error("没有在 PPT 中找到幻灯片，文件可能损坏或不是标准 .pptx");
  }

  const pages = [];
  for (let index = 0; index < slideFiles.length; index += 1) {
    const xml = await zip.files[slideFiles[index]].async("string");
    const text = extractSlideText(xml);
    if (text) {
      pages.push({ pageNumber: index + 1, text });
    }
  }

  const fullText = pages
    .map((page) => `第 ${page.pageNumber} 张幻灯片\n${page.text}`)
    .join("\n\n");

  if (fullText.replace(/\s/g, "").length < MIN_EXTRACTED_CHARS) {
    throw new Error(
      "没有从 PPT 中提取到足够文本。这个 PPT 可能是纯图片/扫描版，建议让笔记模型直接读图。"
    );
  }

  const truncated = fullText.length > MAX_EXTRACTED_CHARS;
  return {
    fileName: file.name,
    pageCount: slideFiles.length,
    pages,
    text: truncated ? compactText(fullText, MAX_EXTRACTED_CHARS) : fullText,
    originalCharCount: fullText.length,
    usedCharCount: truncated ? MAX_EXTRACTED_CHARS : fullText.length,
    truncated
  };
}

function extractSlideText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = doc.getElementsByTagName("a:p");
  const lines = [];
  for (const paragraph of Array.from(paragraphs)) {
    const runs = paragraph.getElementsByTagName("a:t");
    const line = Array.from(runs)
      .map((node) => String(node.textContent || ""))
      .join("")
      .trim();
    if (line) lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function slideNumberOf(name) {
  const match = name.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

// jszip 只发 UMD（无 ESM 产物），浏览器里用动态 <script> 注入后从
// window.JSZip 取。先试 /vendor（dist 打包），回退 /node_modules（dev）。
async function loadJsZip() {
  if (!jszipPromise) {
    jszipPromise = injectJsZipScript();
  }
  return jszipPromise;
}

async function injectJsZipScript() {
  if (typeof window !== "undefined" && window.JSZip) {
    return window.JSZip;
  }
  const candidates = ["/vendor/jszip/jszip.min.js", "/node_modules/jszip/dist/jszip.min.js"];
  let lastError = null;
  for (const src of candidates) {
    try {
      await loadScript(src);
      if (typeof window !== "undefined" && window.JSZip) {
        return window.JSZip;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`JSZip 解析库加载失败：${lastError?.message || "未知错误"}`);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.head.appendChild(script);
  });
}

function compactText(text, maxChars) {
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = maxChars - headChars;
  return [
    text.slice(0, headChars),
    "\n\n[中间部分因 PPT 文本过长已省略，生成时保留了开头和结尾内容。]\n\n",
    text.slice(-tailChars)
  ].join("");
}
