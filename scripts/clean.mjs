import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "src-tauri/target",
  ".edge-profile",
  "npm-debug.log",
  "yarn-error.log",
  "pnpm-debug.log"
];

function removePath(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return false;
  fs.rmSync(fullPath, { recursive: true, force: true });
  return true;
}

function removeDsStore(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === ".DS_Store") {
      fs.rmSync(fullPath, { force: true });
      removed += 1;
    } else if (entry.isDirectory() && entry.name !== "node_modules") {
      removed += removeDsStore(fullPath);
    }
  }
  return removed;
}

const removed = targets.filter(removePath);
const dsStoreCount = removeDsStore(root);

if (removed.length) {
  console.log(`已清理：${removed.join(", ")}`);
} else {
  console.log("没有发现需要清理的大体积构建缓存。");
}

if (dsStoreCount) {
  console.log(`已移除 ${dsStoreCount} 个 .DS_Store 文件。`);
}
