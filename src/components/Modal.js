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
  return new Promise((resolve) => {
    const content = document.createElement("div");
    content.innerHTML = `
      <p style="margin-top: 0; font-size: 15px; color: var(--text);">${message}</p>
      <div style="display: flex; gap: 12px; margin-top: 24px; justify-content: flex-end;">
        <button class="secondary-button" id="confirm-cancel">取消</button>
        <button class="primary-button" id="confirm-ok">确定</button>
      </div>
    `;

    const { close } = openModal({ title: "确认提示", content, width: "400px" });

    content.querySelector("#confirm-cancel").addEventListener("click", () => {
      close();
      resolve(false);
    });

    content.querySelector("#confirm-ok").addEventListener("click", () => {
      close();
      resolve(true);
    });
  });
}
