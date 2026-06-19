const MATHJAX_URLS = [
  "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js",
  "https://unpkg.com/mathjax@3/es5/tex-chtml.js"
];
const TYPESET_TIMEOUT_MS = 4500;

let mathJaxPromise = null;

export function hasMathText(root) {
  const text = root?.textContent || "";
  return (
    text.includes("$$") ||
    text.includes("\\(") ||
    text.includes("\\[") ||
    /\\(?:bra|ket|braket|Bra|Ket|Braket)\s*\{/.test(text) ||
    /\$[^$\n]+\$/.test(text)
  );
}

export async function typesetMath(root = document.body) {
  if (!root || !hasMathText(root)) return;

  try {
    prepareMathFallbacks(root);
    await ensureMathJax();
    if (window.MathJax?.typesetClear) {
      window.MathJax.typesetClear([root]);
    }
    await withTimeout(window.MathJax?.typesetPromise?.([root]), TYPESET_TIMEOUT_MS);
  } catch (error) {
    console.warn("MathJax 加载或渲染失败，保留原始 LaTeX 文本。", error);
  } finally {
    recoverMathErrors(root);
    recoverUnprocessedMathSources(root);
  }
}

function prepareMathFallbacks(root) {
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
    if (parts.length <= 1) return;

    const fragment = root.ownerDocument.createDocumentFragment();
    parts.forEach((part) => {
      if (part.math) {
        const span = root.ownerDocument.createElement("span");
        span.className = "math-source";
        span.dataset.mathSource = part.text;
        span.textContent = part.text;
        fragment.appendChild(span);
      } else if (part.text) {
        fragment.appendChild(root.ownerDocument.createTextNode(part.text));
      }
    });
    node.replaceWith(fragment);
  });
}

function recoverMathErrors(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("mjx-merror, merror").forEach((errorNode) => {
    const sourceNode = errorNode.closest?.("[data-math-source]");
    if (!sourceNode || sourceNode.dataset.mathRecovered === "true") return;

    applyMathFallback(sourceNode);
  });
}

function recoverUnprocessedMathSources(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-math-source]").forEach((sourceNode) => {
    if (sourceNode.dataset.mathRecovered === "true") return;
    if (sourceNode.querySelector("mjx-container")) return;
    if (!looksLikeMathSource(sourceNode.textContent || "")) return;
    applyMathFallback(sourceNode);
  });
}

function applyMathFallback(sourceNode) {
  sourceNode.dataset.mathRecovered = "true";
  sourceNode.classList.add("math-render-fallback");
  sourceNode.setAttribute("title", "这段公式没有成功渲染，已显示原始 LaTeX。");
  sourceNode.textContent = sourceNode.dataset.mathSource || sourceNode.textContent || "";
}

function isInsideMathSkip(element) {
  for (let current = element; current; current = current.parentElement) {
    const tag = current.tagName?.toLowerCase();
    if (
      ["script", "noscript", "style", "textarea", "pre", "code", "button", "select", "option", "input"].includes(tag)
    ) {
      return true;
    }
    if (current.matches?.("mjx-container, [data-math-source], .math-render-fallback")) return true;
  }
  return false;
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
  const body = source.slice(1, -1);
  if (!body.trim()) return false;
  return /\\[a-zA-Z]+|[_^{}=+\-*/<>]|[A-Za-z]\s*\(|\d/.test(body);
}

function withTimeout(promise, timeoutMs) {
  if (!promise) return Promise.resolve();
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("MathJax 渲染超时")), timeoutMs);
    })
  ]);
}

function ensureMathJax() {
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
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
    options: {
      skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
    },
    startup: {
      typeset: false
    }
  };

  mathJaxPromise = loadFirstAvailableScript(MATHJAX_URLS).then(() => window.MathJax);
  return mathJaxPromise;
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
  throw lastError || new Error("无法加载 MathJax");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
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
