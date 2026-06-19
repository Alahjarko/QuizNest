import { typesetMath } from "../utils/math.js";

export function openModal({ title, content, width = "640px" }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const dialog = document.createElement("section");
  dialog.className = "modal";
  dialog.style.maxWidth = width;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const header = document.createElement("header");
  header.className = "modal-header";
  header.innerHTML = `<h2>${title}</h2><button class="icon-button" type="button" aria-label="关闭">×</button>`;

  const body = document.createElement("div");
  body.className = "modal-body";
  if (content instanceof Node) body.appendChild(content);
  else body.innerHTML = content || "";

  dialog.append(header, body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  header.querySelector("button").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  window.setTimeout(() => typesetMath(body), 0);

  return { root: backdrop, dialog, body, close };
}

export function confirmAction(message) {
  return window.confirm(message);
}
