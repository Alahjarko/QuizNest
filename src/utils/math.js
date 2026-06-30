import { createMathCacheKey, getCachedMathSvg, saveCachedMathSvg } from "../services/mathRenderCache.js";

const MATHJAX_URLS = [
  "/vendor/mathjax/tex-svg-full.js",
  "/node_modules/mathjax/es5/tex-svg-full.js"
];
const DEV_MATHJAX_URLS = [
  "/node_modules/mathjax/es5/tex-svg-full.js",
  "/vendor/mathjax/tex-svg-full.js"
];
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_ROOT_MARGIN = "360px 0px";

let mathJaxPromise = null;

export function hasMathText(root) {
  const text = root?.textContent || "";
  return looksLikeMathSource(text) || /\\(?:bra|ket|braket|Bra|Ket|Braket)\s*\{/.test(text);
}

export async function typesetMath(root = document.body, options = {}) {
  if (!root || !hasMathText(root)) return;

  prepareMathPlaceholders(root);
  const nodes = getPendingMathNodes(root);
  if (!nodes.length) return;

  await renderMathNodes(nodes, options);
}

export function observeMathInView(targets, options = {}) {
  const elements = Array.from(targets || []).filter(Boolean);
  if (!elements.length) return () => {};

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => {
      typesetMath(element, options);
    });
    return () => {};
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      typesetMath(entry.target, options);
    });
  }, {
    root: options.root || null,
    rootMargin: options.rootMargin || DEFAULT_ROOT_MARGIN,
    threshold: 0.01
  });

  elements.forEach((element) => observer.observe(element));
  return () => observer.disconnect();
}

function prepareMathPlaceholders(root) {
  if (!root?.ownerDocument) return;

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue || "";
      if (!looksLikeMathSource(text)) return NodeFilter.FILTER_REJECT;
      if (isInsideMathSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const parts = splitMathSource(node.nodeValue || "");
    if (!parts.some((part) => part.math)) return;

    const fragment = root.ownerDocument.createDocumentFragment();
    parts.forEach((part) => {
      if (part.math) {
        fragment.appendChild(createMathNode(root.ownerDocument, part.text));
      } else if (part.text) {
        fragment.appendChild(root.ownerDocument.createTextNode(part.text));
      }
    });
    node.replaceWith(fragment);
  });
}

function createMathNode(documentRef, source) {
  const parsed = parseMathSource(source);
  const span = documentRef.createElement("span");
  span.className = `math-source ${parsed.display ? "math-display" : "math-inline"}`;
  span.dataset.mathSource = source;
  span.dataset.mathTex = parsed.tex;
  span.dataset.mathDisplay = String(parsed.display);
  span.textContent = source;
  return span;
}

function getPendingMathNodes(root) {
  return Array.from(root.querySelectorAll("[data-math-source]"))
    .filter((node) => !node.dataset.mathRendered)
    .filter((node) => !isHiddenForMath(node));
}

async function renderMathNodes(nodes, options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE));
  for (let index = 0; index < nodes.length; index += batchSize) {
    const batch = nodes.slice(index, index + batchSize);
    await Promise.all(batch.map((node) => renderMathNode(node)));
    if (index + batchSize < nodes.length) {
      await waitForIdle();
    }
  }
}

async function renderMathNode(node) {
  if (!node?.isConnected || node.dataset.mathRendered === "true") return;

  const source = node.dataset.mathSource || node.textContent || "";
  const tex = node.dataset.mathTex || parseMathSource(source).tex;
  const display = node.dataset.mathDisplay === "true";
  if (!tex.trim()) return;

  try {
    node.classList.add("math-render-pending");
    const key = await createMathCacheKey({ tex, display });
    const cachedSvg = await getCachedMathSvg(key);
    if (cachedSvg) {
      applyRenderedSvg(node, cachedSvg);
      return;
    }

    const svg = await renderTexToSvg({ tex, display });
    applyRenderedSvg(node, svg);
    await saveCachedMathSvg({ key, source, tex, display, svg });
  } catch (error) {
    node.dataset.mathRenderError = error.message || "公式渲染失败";
    node.classList.remove("math-render-pending");
    node.classList.add("math-render-retryable");
    node.setAttribute("title", `公式暂未渲染成功：${error.message || "未知错误"}`);
    console.warn("公式渲染失败，保留原始 LaTeX 文本。", error);
  }
}

async function renderTexToSvg({ tex, display }) {
  const mathJax = await ensureMathJax();
  if (!mathJax?.tex2svgPromise) {
    throw new Error("MathJax SVG 渲染器不可用");
  }

  // 确保 boldsymbol 扩展已激活（full bundle 内置代码但可能未自动注册）
  await ensureBoldsymbolPackage(mathJax);

  const container = await mathJax.tex2svgPromise(tex, { display });
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("MathJax 未返回 SVG");

  // 检测 merror（未知命令会产生红色错误节点）
  if (container.querySelector("mjx-merror, merror")) {
    const errText = container.querySelector("mjx-merror, merror")?.textContent || "";
    throw new Error(`MathJax 解析错误: ${errText.slice(0, 80)}`);
  }

  svg.setAttribute("aria-hidden", "true");
  svg.removeAttribute("focusable");
  return svg.outerHTML;
}

function applyRenderedSvg(node, svg) {
  node.innerHTML = svg;
  node.dataset.mathRendered = "true";
  delete node.dataset.mathRenderError;
  node.classList.remove("math-render-pending", "math-render-retryable");
  node.classList.add("math-rendered");
}

function isInsideMathSkip(element) {
  for (let current = element; current; current = current.parentElement) {
    const tag = current.tagName?.toLowerCase();
    if (
      ["script", "noscript", "style", "textarea", "pre", "code", "button", "select", "option", "input"].includes(tag)
    ) {
      return true;
    }
    if (current.matches?.("svg, mjx-container, [data-math-source]")) return true;
  }
  return false;
}

function isHiddenForMath(element) {
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return true;
    const tag = current.tagName?.toLowerCase();
    if (tag === "details" && !current.open && !isInsideDetailsSummary(element, current)) return true;
  }
  return false;
}

function isInsideDetailsSummary(element, details) {
  const summary = Array.from(details.children || []).find((child) => child.tagName?.toLowerCase() === "summary");
  return Boolean(summary?.contains(element));
}

function splitMathSource(text) {
  const matches = [];
  const patterns = [
    /\\\[[\s\S]+?\\\]/g,
    /\$\$[\s\S]+?\$\$/g,
    /\\\([^\n]+?\\\)/g,
    /\$(?!\s)(?:\\.|[^$\n]){1,240}?\$/g
  ];

  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (!isLikelyMathExpression(value)) continue;
      matches.push({ start: match.index, end: match.index + value.length, text: value });
    }
  });

  const ordered = matches
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((match, index, list) => !list.some((other, otherIndex) => otherIndex < index && match.start < other.end));

  if (!ordered.length) return [{ text, math: false }];

  const parts = [];
  let cursor = 0;
  ordered.forEach((match) => {
    if (match.start > cursor) parts.push({ text: text.slice(cursor, match.start), math: false });
    parts.push({ text: match.text, math: true });
    cursor = match.end;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), math: false });
  return parts;
}

function parseMathSource(source) {
  const text = String(source || "");
  if (text.startsWith("\\[") && text.endsWith("\\]")) {
    return { tex: text.slice(2, -2), display: true };
  }
  if (text.startsWith("$$") && text.endsWith("$$")) {
    return { tex: text.slice(2, -2), display: true };
  }
  if (text.startsWith("\\(") && text.endsWith("\\)")) {
    return { tex: text.slice(2, -2), display: false };
  }
  if (text.startsWith("$") && text.endsWith("$")) {
    return { tex: text.slice(1, -1), display: false };
  }
  return { tex: text, display: false };
}

function looksLikeMathSource(text) {
  return (
    text.includes("$$") ||
    text.includes("\\(") ||
    text.includes("\\[") ||
    /\$[^$\n]+\$/.test(text)
  );
}

function isLikelyMathExpression(source) {
  if (source.startsWith("\\(") || source.startsWith("\\[") || source.startsWith("$$")) return true;
  const body = source.slice(1, -1).trim();
  return body.length > 0;
}

async function waitForIdle() {
  if ("requestIdleCallback" in window) {
    await new Promise((resolve) => window.requestIdleCallback(resolve, { timeout: 250 }));
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 16));
}

let boldsymbolChecked = false;

async function ensureBoldsymbolPackage(mathJax) {
  if (boldsymbolChecked) return;
  boldsymbolChecked = true;

  const mj = mathJax || window.MathJax;
  const pkgs = mj?.config?.tex?.packages;
  if (Array.isArray(pkgs) && pkgs.includes("boldsymbol")) return;

  try {
    if (mj?.loader?.load) {
      await mj.loader.load("[tex]/boldsymbol");
      await mj?.startup?.promise;
    }
  } catch (e) {
    console.warn("boldsymbol 扩展加载失败", e.message);
  }
}

function ensureMathJax() {
  if (window.MathJax?.tex2svgPromise) return Promise.resolve(window.MathJax);
  if (mathJaxPromise) return mathJaxPromise;

  window.MathJax = {
    tex: {
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"]
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"]
      ],
      processEscapes: true,
      processEnvironments: true,
      packages: [
        "base",
        "require",
        "autoload",
        "ams",
        "amscd",
        "bbox",
        "boldsymbol",
        "braket",
        "bussproofs",
        "cancel",
        "cases",
        "centernot",
        "color",
        "colortbl",
        "empheq",
        "enclose",
        "extpfeil",
        "gensymb",
        "html",
        "mathtools",
        "mhchem",
        "newcommand",
        "noerrors",
        "noundefined",
        "upgreek",
        "unicode",
        "verb",
        "configmacros",
        "tagformat",
        "textcomp",
        "textmacros"
      ],
      macros: {
        bra: ["\\left\\langle #1 \\right|", 1],
        ket: ["\\left| #1 \\right\\rangle", 1],
        braket: ["\\left\\langle #1 \\right\\rangle", 1],
        Bra: ["\\left\\langle #1 \\right|", 1],
        Ket: ["\\left| #1 \\right\\rangle", 1],
        Braket: ["\\left\\langle #1 \\right\\rangle", 1],
        ketbra: ["\\left| #1 \\right\\rangle\\!\\left\\langle #2 \\right|", 2],
        expval: ["\\left\\langle #1 \\right\\rangle", 1],
        abs: ["\\left| #1 \\right|", 1],
        norm: ["\\left\\lVert #1 \\right\\rVert", 1]
      }
    },
    svg: {
      fontCache: "local"
    },
    startup: {
      typeset: false
    }
  };

  mathJaxPromise = loadFirstAvailableScript(getMathJaxUrls()).then(async () => {
    await window.MathJax?.startup?.promise;
    return window.MathJax;
  });
  return mathJaxPromise;
}

function getMathJaxUrls() {
  return ["5173", "4173"].includes(window.location.port) ? DEV_MATHJAX_URLS : MATHJAX_URLS;
}

async function loadFirstAvailableScript(urls) {
  let lastError;
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法加载本地 MathJax");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.MathJax?.tex2svgPromise) {
        resolve();
        return;
      }
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`加载失败：${src}`));
    document.head.appendChild(script);
  });
}
