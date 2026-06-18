// Theme switcher dropdown. The <select id="theme-select"> is kept (hidden) for
// state + app.js compatibility; this renders a custom menu off the toolbar's
// palette button and drives the select via its change event.
const select = document.getElementById("theme-select");
const btn = document.getElementById("theme-btn");

if (select && btn) {
  let menu = null;

  const onDoc = (e) => {
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  function close() {
    menu?.remove();
    menu = null;
    btn.classList.remove("active");
    document.removeEventListener("click", onDoc);
    document.removeEventListener("keydown", onKey);
  }

  function open() {
    menu = document.createElement("div");
    menu.className = "tb-menu";
    [...select.options].forEach((o) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tb-menu-item" + (o.value === select.value ? " active" : "");
      item.textContent = o.textContent;
      item.addEventListener("click", () => {
        select.value = o.value;
        select.dispatchEvent(new Event("change"));
        close();
      });
      menu.append(item);
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    btn.classList.add("active");
    setTimeout(() => {
      document.addEventListener("click", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu ? close() : open();
  });
}
