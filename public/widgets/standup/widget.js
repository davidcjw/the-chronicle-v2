// Escape remote-derived text before interpolating into innerHTML (DOM XSS guard).
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default {
  id: "standup",
  title: "Standup",
  icon: "📝",
  size: "normal",

  async load() {
    const res = await fetch("/api/standup");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  render(data, el) {
    if (data.error) {
      const p = document.createElement("p");
      p.className = "widget-error";
      p.textContent = data.error;
      el.replaceChildren(p);
      return;
    }

    const today = new Date().toLocaleDateString("en-SG", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const bullets = data.bullets || [];
    const text = bullets.length ? bullets.map((b) => `• ${b}`).join("\n") : "• ";

    el.innerHTML = `
      <style>
        .standup-wrap { display: flex; flex-direction: column; height: 100%; }
        .standup-date { font-size: .72rem; color: var(--text-muted); margin-bottom: .6rem; letter-spacing: .02em; flex-shrink: 0; }
        .standup-textarea {
          flex: 1;
          width: 100%;
          min-height: 80px;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: .85rem;
          line-height: 1.6;
          padding: .5rem .7rem;
          resize: none;
          outline: none;
          font-family: inherit;
        }
        .standup-textarea:focus { border-color: var(--accent); }
        .standup-footer {
          display: flex;
          align-items: center;
          gap: .6rem;
          margin-top: .5rem;
          flex-shrink: 0;
        }
        .standup-hint { font-size: .7rem; color: var(--text-muted); flex: 1; }
        .standup-status { font-size: .72rem; color: var(--text-muted); }
        .standup-save {
          background: var(--accent-dim);
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: var(--radius-sm);
          padding: .35rem .8rem;
          font-size: .825rem;
          cursor: pointer;
          transition: background .15s;
          flex-shrink: 0;
        }
        .standup-save:hover { background: #818cf840; }
        .standup-save:disabled { opacity: .5; cursor: default; }
      </style>
      <div class="standup-wrap">
        <p class="standup-date">${today}</p>
        <textarea
          class="standup-textarea"
          placeholder="What did you do yesterday?&#10;What will you do today?&#10;Any blockers?"
        >${escHtml(text)}</textarea>
        <div class="standup-footer">
          <span class="standup-hint">One note per line → saves as bullets</span>
          <span class="standup-status"></span>
          <button class="standup-save">Save</button>
        </div>
      </div>`;

    const textarea = el.querySelector(".standup-textarea");
    const saveBtn = el.querySelector(".standup-save");
    const status = el.querySelector(".standup-status");

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const s = textarea.selectionStart;
        const val = textarea.value;
        textarea.value = val.slice(0, s) + "\n• " + val.slice(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = s + 3;
      }
    });

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const bullets = textarea.value
        .split("\n")
        .map((l) => l.replace(/^•\s*/, "").trim())
        .filter(Boolean);
      try {
        const res = await fetch("/api/standup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bullets }),
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        status.textContent = "Saved ✓";
        setTimeout(() => {
          status.textContent = "";
        }, 2500);
      } catch (err) {
        status.textContent = "Error saving";
        console.error("[standup] save failed:", err);
      } finally {
        saveBtn.disabled = false;
      }
    });
  },
};
