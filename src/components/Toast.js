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

export function showInteractiveToast(message, options = {}) {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const item = document.createElement("div");
  item.className = `toast toast-success toast-clickable`;
  item.textContent = message;

  if (options.onClick) {
    item.addEventListener("click", () => {
      options.onClick();
      closeToast(); // auto close on click
    });
  }

  root.appendChild(item);

  const duration = options.duration || 10000;
  let timerId = null;
  let remaining = duration;
  let start = Date.now();

  const closeToast = () => {
    item.classList.add("toast-out");
    window.setTimeout(() => item.remove(), 240);
  };

  const resume = () => {
    start = Date.now();
    timerId = window.setTimeout(closeToast, remaining);
  };

  const pause = () => {
    window.clearTimeout(timerId);
    remaining -= (Date.now() - start);
  };

  item.addEventListener("mouseenter", pause);
  item.addEventListener("mouseleave", resume);

  resume();
}
