const MAX_PDF_SIZE = 40 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120_000;

let pdfjsPromise = null;

export async function extractPdfText(file) {
  if (!file) throw new Error("请先选择 PDF 文件");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    throw new Error("请上传 .pdf 文件");
  }
  if (file.size > MAX_PDF_SIZE) {
    throw new Error("PDF 超过 40MB，请先压缩或拆分后再导入");
  }

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => String(item.str || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      pages.push({ pageNumber, text });
    }
  }

  const fullText = pages.map((page) => `第 ${page.pageNumber} 页\n${page.text}`).join("\n\n");
  if (fullText.replace(/\s/g, "").length < 80) {
    throw new Error("没有从 PDF 中提取到足够文本。这个 PDF 可能是扫描版图片，请先 OCR 后再导入。");
  }

  const truncated = fullText.length > MAX_EXTRACTED_CHARS;
  return {
    fileName: file.name,
    pageCount: pdf.numPages,
    pages,
    text: truncated ? compactText(fullText, MAX_EXTRACTED_CHARS) : fullText,
    originalCharCount: fullText.length,
    usedCharCount: truncated ? MAX_EXTRACTED_CHARS : fullText.length,
    truncated
  };
}

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = importPdfJs();
  }
  return pdfjsPromise;
}

async function importPdfJs() {
  const candidates = [
    "/vendor/pdfjs/pdf.mjs",
    "/node_modules/pdfjs-dist/build/pdf.mjs"
  ];
  let lastError = null;
  for (const path of candidates) {
    try {
      const pdfjs = await import(path);
      const workerPath = path.includes("/vendor/") ? "/vendor/pdfjs/pdf.worker.mjs" : "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
      pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
      return pdfjs;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`PDF 解析库加载失败：${lastError?.message || "未知错误"}`);
}

function compactText(text, maxChars) {
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = maxChars - headChars;
  return [
    text.slice(0, headChars),
    "\n\n[中间部分因 PDF 文本过长已省略，生成时保留了开头和结尾内容。]\n\n",
    text.slice(-tailChars)
  ].join("");
}
