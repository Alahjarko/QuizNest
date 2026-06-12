export function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.textContent = message;
  root.appendChild(item);

  window.setTimeout(() => {
    item.classList.add("toast-out");
    window.setTimeout(() => item.remove(), 240);
  }, 3200);
}
