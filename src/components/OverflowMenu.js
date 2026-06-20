export function renderOverflowMenu({ label = "更多操作", items = "" } = {}) {
  return `
    <details class="card-overflow-menu">
      <summary aria-label="${label}" title="${label}">
        ${moreIcon()}
      </summary>
      <div class="card-overflow-panel" role="menu">
        ${items}
      </div>
    </details>
  `;
}

export function bindOverflowMenus(root) {
  const menus = [...root.querySelectorAll(".card-overflow-menu")];

  menus.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      menus.forEach((other) => {
        if (other !== menu) other.open = false;
      });
    });

    menu.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        menu.open = false;
      });
    });
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest(".card-overflow-menu")) return;
    menus.forEach((menu) => {
      menu.open = false;
    });
  });
}

function moreIcon() {
  return `
    <svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="5" r="1"></circle>
      <circle cx="12" cy="12" r="1"></circle>
      <circle cx="12" cy="19" r="1"></circle>
    </svg>
  `;
}
