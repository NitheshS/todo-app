/* Service worker */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

/* Install prompt */
let deferredPrompt;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = "inline-block";
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = "none";
});

/* Storage via localForage with fallback */
const store = (() => {
  if (window.localforage) {
    // Configure once before using getItem/setItem per localForage docs
    localforage.config({ name: "pro-todo", storeName: "tasks" });
    return {
      async get() {
        const v = await localforage.getItem("tasks");
        return Array.isArray(v) ? v : [];
      },
      async set(val) {
        return localforage.setItem("tasks", val);
      },
    };
  }
  return {
    async get() {
      try {
        const raw = localStorage.getItem("tasks");
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
    async set(val) {
      localStorage.setItem("tasks", JSON.stringify(val));
    },
  };
})();

/* Settings store */
const settingsStore = (() => {
  if (window.localforage) {
    // Use a separate key space via a different key
    localforage.config({ name: "pro-todo" });
    return {
      async get() {
        const s = await localforage.getItem("settings");
        return s || {};
      },
      async set(v) {
        return localforage.setItem("settings", v);
      },
    };
  }
  return {
    async get() {
      try {
        const raw = localStorage.getItem("settings");
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    },
    async set(v) {
      localStorage.setItem("settings", JSON.stringify(v));
    },
  };
})();

/* Model helpers */
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const nowIso = () => new Date().toISOString();

/* In-memory state */
let tasks = [];
let inbox = [];
let currentFilter = "all";
let currentSort = "order";
let query = "";

/* Elements */
const els = {
  themeToggle: document.getElementById("themeToggle"),
  themeLabel: document.getElementById("themeLabel"),
  autoThemeToggle: document.getElementById("autoThemeToggle"),
  quickAdd: document.getElementById("quickAdd"),
  addBtn: document.getElementById("addBtn"),
  chips: document.querySelectorAll(".chip"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  taskList: document.getElementById("taskList"),
  kanbanToggle: document.getElementById("kanbanToggle"),
  calendarToggle: document.getElementById("calendarToggle"),
  statsToggle: document.getElementById("statsToggle"),
  settingsToggle: document.getElementById("settingsToggle"),
  sections: {
    list: document.getElementById("taskSection"),
    kanban: document.getElementById("kanbanSection"),
    calendar: document.getElementById("calendarSection"),
    stats: document.getElementById("statsSection"),
    settings: document.getElementById("settingsSection"),
  },
  dialog: document.getElementById("editDialog"),
  inboxDialog: document.getElementById("inboxDialog"),
  inboxBtn: document.getElementById("inboxBtn"),
  inboxBadge: document.getElementById("inboxBadge"),
  inboxList: document.getElementById("inboxList"),
  clearInbox: document.getElementById("clearInbox"),
  closeInbox: document.getElementById("closeInbox"),
  goalCount: document.getElementById("goalCount"),
  completedToday: document.getElementById("completedToday"),
  goalProgress: document.getElementById("goalProgress"),
  streakDays: document.getElementById("streakDays"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  soundToggle: document.getElementById("soundToggle"),
  dailyGoal: document.getElementById("dailyGoal"),
  ding: document.getElementById("ding"),
};

/* Init */
(async function init() {
  await migrateIfNeeded();
  tasks = await store.get();
  const settings = await settingsStore.get();
  setupTheme(settings);
  setupSettings(settings);
  renderAll();
  requestNotificationPermission();
  setInterval(checkReminders, 15000);
})();

/* Migration: ensure ids/order/created/status */
async function migrateIfNeeded() {
  const arr = await store.get();
  let changed = false;
  arr.forEach((t, i) => {
    if (!t.id) {
      t.id = uid();
      changed = true;
    }
    if (t.order == null) {
      t.order = i;
      changed = true;
    }
    if (!t.createdAt) {
      t.createdAt = nowIso();
      changed = true;
    }
    if (!t.status) {
      t.status = t.completed ? "completed" : "pending";
      changed = true;
    }
  });
  if (changed) await store.set(arr);
}

/* Theme */
function setupTheme(settings) {
  const prefers = window.matchMedia("(prefers-color-scheme: light)");
  const setMode = (light) => {
    document.documentElement.classList.toggle("light", light);
    if (els.themeLabel) els.themeLabel.textContent = light ? "🌙" : "🌞";
  };
  const mode = settings.autoTheme
    ? prefers.matches
    : settings.theme === "light";
  setMode(mode);
  if (els.themeToggle) els.themeToggle.checked = mode;
  if (els.autoThemeToggle) els.autoThemeToggle.checked = !!settings.autoTheme;

  prefers.addEventListener("change", () => {
    if (els.autoThemeToggle?.checked) setMode(prefers.matches);
  });

  els.themeToggle?.addEventListener("change", async () => {
    const s = await settingsStore.get();
    s.theme = els.themeToggle.checked ? "light" : "dark";
    s.autoTheme = false;
    await settingsStore.set(s);
    setMode(els.themeToggle.checked);
  });

  els.autoThemeToggle?.addEventListener("change", async () => {
    const s = await settingsStore.get();
    s.autoTheme = els.autoThemeToggle.checked;
    await settingsStore.set(s);
    setMode(
      els.autoThemeToggle.checked
        ? window.matchMedia("(prefers-color-scheme: light)").matches
        : els.themeToggle.checked
    );
  });
}

/* Settings */
function setupSettings(s) {
  if (els.soundToggle) els.soundToggle.checked = !!s.sound;
  if (els.dailyGoal) els.dailyGoal.value = s.dailyGoal ?? 5;
  if (els.goalCount) els.goalCount.textContent = els.dailyGoal?.value || "5";

  els.soundToggle?.addEventListener("change", async () => {
    const st = await settingsStore.get();
    st.sound = els.soundToggle.checked;
    await settingsStore.set(st);
  });

  els.dailyGoal?.addEventListener("change", async () => {
    const st = await settingsStore.get();
    st.dailyGoal = parseInt(els.dailyGoal.value || "5", 10);
    await settingsStore.set(st);
    if (els.goalCount) els.goalCount.textContent = String(st.dailyGoal);
    updateStats();
  });

  els.exportBtn?.addEventListener("click", exportJson);
  els.importFile?.addEventListener("change", importJson);
}

/* Export/Import */
function exportJson() {
  const blob = new Blob([JSON.stringify({ tasks }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pro-todo-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const text = await f.text();
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      tasks = data;
    } else if (Array.isArray(data.tasks)) {
      tasks = data.tasks;
    } else {
      alert("Invalid JSON structure");
      return;
    }
    await store.set(tasks);
    renderAll();
  } catch {
    alert("Failed to parse JSON");
  }
}

/* Quick add parser */
function parseQuickAdd(input) {
  let text = input.trim();
  let priority = 0,
    tags = [],
    notes = "",
    due = null,
    remindAt = null;

  // Tags: #tag
  const tagRe = /(^|\s)#([a-z0-9_-]+)/gi;
  text = text
    .replace(tagRe, (m, s, t) => {
      tags.push(t.toLowerCase());
      return "";
    })
    .trim();

  // Priority: !low|!med|!medium|!high|!1|!2|!3
  const pr = /(^|\s)!(low|med|medium|high|1|2|3)\b/i;
  const pm = text.match(pr);
  if (pm) {
    const v = pm[2].toLowerCase();
    priority =
      v === "high" || v === "3"
        ? 3
        : v === "med" || v === "medium" || v === "2"
        ? 2
        : 1;
    text = text.replace(pr, "").trim();
  }

  // Notes: +note ...
  const noteRe = /(^|\s)\+note\s(.+)$/i;
  const nm = text.match(noteRe);
  if (nm) {
    notes = nm[2].trim();
    text = text.replace(noteRe, "").trim();
  }

  // Natural times: today, tomorrow, next week, with optional time like 9am or 17:00
  const lower = input.toLowerCase();
  const now = new Date();
  const date = new Date(now);
  if (lower.includes("tomorrow")) date.setDate(now.getDate() + 1);
  else if (lower.includes("today")) date.setDate(now.getDate());
  else if (lower.includes("next week")) date.setDate(now.getDate() + 7);

  const timeMatch = lower.match(/(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const mer = timeMatch[3];
    if (mer) {
      if (mer === "pm" && h < 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
    }
    date.setHours(h, m, 0, 0);
    due = date.toISOString();
  } else if (
    lower.includes("today") ||
    lower.includes("tomorrow") ||
    lower.includes("next week")
  ) {
    date.setHours(17, 0, 0, 0);
    due = date.toISOString();
  }
  remindAt = due
    ? new Date(new Date(due).getTime() - 15 * 60000).toISOString()
    : null;

  return { text, priority, tags, notes, due, remindAt };
}

/* CRUD */
async function addTaskFromInput() {
  const raw = els.quickAdd?.value.trim();
  if (!raw) return;
  const parsed = parseQuickAdd(raw);
  const t = {
    id: uid(),
    text: parsed.text || raw,
    notes: parsed.notes || "",
    completed: false,
    status: "pending",
    createdAt: nowIso(),
    due: parsed.due,
    remindAt: parsed.remindAt,
    priority: parsed.priority,
    tags: parsed.tags,
    subtasks: [],
    repeat: "",
    archived: false,
    order: tasks.length,
    notified: false,
  };
  tasks.push(t);
  await store.set(tasks);
  if (els.quickAdd) els.quickAdd.value = "";
  renderAll();
}

/* Filtering and sorting */
function taskMatches(t) {
  if (t.archived) return currentFilter === "archived";

  const q = query.toLowerCase();

  // search text or any "#tag" token that includes the query
  const inSearch =
    !q ||
    t.text.toLowerCase().includes(q) ||
    (t.tags || []).some((tag) => `#${String(tag).toLowerCase()}`.includes(q));

  if (!inSearch) return false;

  const now = new Date();
  const due = t.due ? new Date(t.due) : null;

  switch (currentFilter) {
    case "all":
      return true;
    case "pending":
      return t.status === "pending" && !t.completed;
    case "doing":
      return t.status === "doing" && !t.completed;
    case "completed":
      return t.completed;
    case "today":
      return !!due && due.toDateString() === now.toDateString();
    case "overdue":
      return !!due && due < now && !t.completed;
    case "scheduled":
      return !!due;
    case "archived":
      return t.archived;
    default:
      return true;
  }
}

function sortTasks(arr) {
  const prRank = (p) => p ?? 0;
  if (currentSort === "order")
    return arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (currentSort === "dueAsc")
    return arr.sort(
      (a, b) =>
        (a.due ? new Date(a.due) : Infinity) -
        (b.due ? new Date(b.due) : Infinity)
    );
  if (currentSort === "dueDesc")
    return arr.sort(
      (a, b) =>
        (b.due ? new Date(b.due) : -Infinity) -
        (a.due ? new Date(a.due) : -Infinity)
    );
  if (currentSort === "priorityDesc")
    return arr.sort((a, b) => prRank(b.priority) - prRank(a.priority));
  if (currentSort === "createdDesc")
    return arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return arr;
}

/* Rendering helpers */
function prioBadge(p) {
  if (!p) return "";
  const lbl = p === 3 ? "High" : p === 2 ? "Medium" : "Low";
  return `<span class="tag badge-prio-${p}">${lbl}</span>`;
}

function dueBadge(t) {
  if (!t.due) return "";
  const d = new Date(t.due);
  const now = new Date();
  const cls =
    d < now && !t.completed ? "overdue" : d - now < 3600000 ? "dueSoon" : "";
  return `<span class="${cls}">⏰ ${d.toLocaleString()}</span>`;
}

function tagsRow(tags) {
  return (tags || [])
    .map((x) => `<span class="tag">#${escapeHtml(String(x))}</span>`)
    .join(" ");
}

function taskCard(t) {
  return `
    <li class="card draggable" draggable="true" data-id="${t.id}">
      <div class="title">
        <input type="checkbox" ${
          t.completed ? "checked" : ""
        } aria-label="Complete" data-action="toggle" />
        <div class="text">
          <div>${escapeHtml(t.text)}</div>
          <div class="meta">
            ${prioBadge(t.priority)} ${dueBadge(t)} ${tagsRow(t.tags)}
          </div>
        </div>
      </div>
      ${
        t.subtasks?.length
          ? `<div class="subtasks">
              ${t.subtasks
                .map(
                  (s, i) =>
                    `<label><input data-sub="${i}" data-action="subtoggle" type="checkbox" ${
                      s.done ? "checked" : ""
                    }/> ${escapeHtml(s.text)}</label>`
                )
                .join("")}
            </div>`
          : ""
      }
      ${t.notes ? `<div class="meta">🗒️ ${escapeHtml(t.notes)}</div>` : ""}
      <div class="actions-row">
        <button data-action="edit">✏️ Edit</button>
        <button data-action="start">${
          t.status === "doing" ? "⏹️ Stop" : "▶️ Start"
        }</button>
        <button data-action="snooze">😴 Snooze</button>
        <button data-action="archive">${
          t.archived ? "Unarchive" : "Archive"
        }</button>
        <button data-action="delete">❌ Delete</button>
      </div>
    </li>
  `;
}

/* Render sections */
function renderAll() {
  renderList();
  renderKanban();
  renderCalendar();
  updateStats();
  updateInboxBadge();
}

function renderList() {
  if (!els.taskList) return;
  const list = tasks.filter(taskMatches);
  sortTasks(list);
  els.taskList.innerHTML = list.map(taskCard).join("");
  enableDnD(els.taskList);
}

function renderKanban() {
  const sec = document.getElementById("kanbanSection");
  if (!sec || sec.classList.contains("hidden")) return;
  ["pending", "doing", "completed"].forEach((col) => {
    const ul = document.getElementById(`col-${col}`);
    if (!ul) return;
    const list = tasks.filter((t) => t.status === col && !t.archived);
    sortTasks(list);
    ul.innerHTML = list.map(taskCard).join("");
    enableDnD(ul, col);
  });
}

function renderCalendar() {
  const sec = document.getElementById("calendarSection");
  if (!sec || sec.classList.contains("hidden")) return;
  const container = document.getElementById("calendar");
  if (!container) return;
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  let cells = "";
  for (let day = 1; day <= last.getDate(); day++) {
    const dateStr = new Date(d.getFullYear(), d.getMonth(), day).toDateString();
    const dots = tasks
      .filter((t) => t.due && new Date(t.due).toDateString() === dateStr)
      .slice(0, 5)
      .map(() => '<span class="dot"></span>')
      .join("");
    cells += `<div class="cell"><div>${day}</div><div>${dots}</div></div>`;
  }
  container.innerHTML = `<div class="grid">${cells}</div>`;
}

/* Stats */
function updateStats() {
  const today = new Date().toDateString();
  const completedTodayCount = tasks.filter(
    (t) => t.completed && new Date(t.createdAt).toDateString() === today
  ).length;
  if (els.completedToday)
    els.completedToday.textContent = String(completedTodayCount);
  const goal = parseInt(els.dailyGoal?.value || "5", 10);
  const pct = Math.min(100, Math.round((completedTodayCount / goal) * 100));
  if (els.goalProgress) els.goalProgress.style.width = pct + "%";

  const sKey = "streak";
  const s = JSON.parse(localStorage.getItem(sKey) || '{"count":0,"date":""}');
  const last = s.date;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (completedTodayCount > 0 && last !== today) {
    if (last === yest.toDateString()) s.count += 1;
    else s.count = 1;
    s.date = today;
    localStorage.setItem(sKey, JSON.stringify(s));
  }
  const sc = JSON.parse(localStorage.getItem(sKey) || '{"count":0}').count || 0;
  if (els.streakDays) els.streakDays.textContent = String(sc);
}

/* Drag and drop */
function enableDnD(root, colForKanban = null) {
  root.querySelectorAll(".draggable").forEach((item) => {
    item.addEventListener("dragstart", () => item.classList.add("dragging"));
    item.addEventListener("dragend", async () => {
      item.classList.remove("dragging");
      const ids = Array.from(root.querySelectorAll(".draggable")).map(
        (li) => li.dataset.id
      );
      ids.forEach((id, idx) => {
        const t = tasks.find((x) => x.id === id);
        if (t) {
          t.order = idx;
          if (colForKanban) t.status = colForKanban;
        }
      });
      await store.set(tasks);
      renderAll();
    });
  });
  root.addEventListener("dragover", (e) => e.preventDefault());
}

/* Event listeners */
els.addBtn?.addEventListener("click", addTaskFromInput);
els.quickAdd?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTaskFromInput();
});
els.chips.forEach((ch) =>
  ch.addEventListener("click", (e) => {
    els.chips.forEach((c) => c.setAttribute("aria-pressed", "false"));
    e.currentTarget.setAttribute("aria-pressed", "true");
    currentFilter = e.currentTarget.dataset.filter;
    renderAll();
  })
);
els.searchInput?.addEventListener("input", (e) => {
  query = e.target.value.trim();
  renderAll();
});
els.sortSelect?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  renderAll();
});

function toggleSection(btn, key, el) {
  const show = el.classList.contains("hidden");
  [
    "taskSection",
    "kanbanSection",
    "calendarSection",
    "statsSection",
    "settingsSection",
  ].forEach((id) => document.getElementById(id)?.classList.add("hidden"));
  if (show) el.classList.remove("hidden");
  else document.getElementById("taskSection")?.classList.remove("hidden");
  btn?.setAttribute("aria-pressed", String(show));
  renderAll();
}
els.kanbanToggle?.addEventListener("click", () =>
  toggleSection(
    els.kanbanToggle,
    "kanban",
    document.getElementById("kanbanSection")
  )
);
els.calendarToggle?.addEventListener("click", () =>
  toggleSection(
    els.calendarToggle,
    "calendar",
    document.getElementById("calendarSection")
  )
);
els.statsToggle?.addEventListener("click", () =>
  toggleSection(
    els.statsToggle,
    "stats",
    document.getElementById("statsSection")
  )
);
els.settingsToggle?.addEventListener("click", () =>
  toggleSection(
    els.settingsToggle,
    "settings",
    document.getElementById("settingsSection")
  )
);

/* Delegated clicks */
document.addEventListener("click", async (e) => {
  const li = e.target.closest("li.card");
  if (!li) return;
  const id = li.dataset.id;
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  const act = e.target.dataset.action;

  if (act === "toggle") {
    t.completed = !t.completed;
    t.status = t.completed ? "completed" : "pending";
    await store.set(tasks);
    renderAll();
    updateStats();
    return;
  }
  if (act === "subtoggle") {
    const idx = parseInt(e.target.getAttribute("data-sub"), 10);
    t.subtasks[idx].done = e.target.checked;
    await store.set(tasks);
    renderAll();
    return;
  }
  if (act === "edit") {
    openEdit(t);
    return;
  }
  if (act === "start") {
    t.status = t.status === "doing" ? "pending" : "doing";
    await store.set(tasks);
    renderAll();
    return;
  }
  if (act === "archive") {
    t.archived = !t.archived;
    await store.set(tasks);
    renderAll();
    return;
  }
  if (act === "snooze") {
    if (t.due) {
      const d = new Date(t.due);
      d.setMinutes(d.getMinutes() + 30);
      t.due = d.toISOString();
      if (t.remindAt) {
        const r = new Date(t.remindAt);
        r.setMinutes(r.getMinutes() + 30);
        t.remindAt = r.toISOString();
      }
      t.notified = false;
      await store.set(tasks);
      renderAll();
    }
    return;
  }
  if (act === "delete") {
    if (confirm("Delete task?")) {
      tasks = tasks.filter((x) => x.id !== id);
      await store.set(tasks);
      renderAll();
    }
  }
});

/* Edit dialog */
function openEdit(t) {
  const d = els.dialog;
  if (!d) return;
  d.returnValue = "";
  d.showModal();
  const et = document.getElementById("editText");
  const en = document.getElementById("editNotes");
  const ed = document.getElementById("editDue");
  const er = document.getElementById("editRemind");
  const epr = document.getElementById("editPriority");
  const etg = document.getElementById("editTags");
  const edo = document.getElementById("editDoing");
  const eco = document.getElementById("editCompleted");
  const erep = document.getElementById("editRepeat");
  const subC = document.getElementById("subtasksContainer");

  et.value = t.text;
  en.value = t.notes || "";
  ed.value = t.due ? t.due.slice(0, 16) : "";
  er.value = t.remindAt ? t.remindAt.slice(0, 16) : "";
  epr.value = t.priority || 0;
  etg.value = (t.tags || []).map((x) => `#${x}`).join(" ");
  edo.checked = t.status === "doing";
  eco.checked = t.completed;
  erep.value = t.repeat || "";
  subC.innerHTML = (t.subtasks || [])
    .map(
      (s, i) =>
        `<div>
          <input data-i="${i}" class="subtext" value="${escapeAttr(s.text)}"/>
          <input type="checkbox" class="subdone" ${s.done ? "checked" : ""}/>
        </div>`
    )
    .join("");

  document.getElementById("addSubtaskBtn").onclick = () => {
    t.subtasks.push({ text: "New subtask", done: false });
    openEdit(t);
  };

  document.getElementById("saveEditBtn").onclick = async () => {
    t.text = et.value.trim() || t.text;
    t.notes = en.value.trim();
    t.due = ed.value ? new Date(ed.value).toISOString() : null;
    t.remindAt = er.value ? new Date(er.value).toISOString() : null;
    t.priority = parseInt(epr.value || "0", 10);
    t.tags = etg.value
      .split(/\s+/)
      .filter(Boolean)
      .map((x) => x.replace(/^#/, "").toLowerCase());
    t.status = edo.checked ? "doing" : eco.checked ? "completed" : "pending";
    t.completed = eco.checked;
    t.repeat = erep.value || "";
    const subs = Array.from(subC.querySelectorAll(".subtext")).map(
      (inp, i) => ({
        text: inp.value,
        done: subC.querySelectorAll(".subdone")[i].checked,
      })
    );
    t.subtasks = subs;
    await store.set(tasks);
    d.close();
    renderAll();
  };
}

/* Notifications */
function requestNotificationPermission() {
  if ("Notification" in window) Notification.requestPermission();
}

function notify(t) {
  inbox.push({ id: uid(), text: t.text, at: new Date().toISOString() });
  updateInboxBadge();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Reminder", { body: t.text });
  }
  els.soundToggle?.checked && els.ding?.play().catch(() => {});
}

function updateInboxBadge() {
  if (!els.inboxBadge) return;
  els.inboxBadge.textContent = inbox.length ? String(inbox.length) : "";
}

els.inboxBtn?.addEventListener("click", () => {
  if (!els.inboxList || !els.inboxDialog) return;
  els.inboxList.innerHTML = inbox
    .map(
      (i) =>
        `<li>${escapeHtml(i.text)} <small>${new Date(
          i.at
        ).toLocaleString()}</small></li>`
    )
    .join("");
  els.inboxDialog.showModal();
});

els.clearInbox?.addEventListener("click", () => {
  inbox = [];
  updateInboxBadge();
  els.inboxDialog?.close();
});

els.closeInbox?.addEventListener("click", () => els.inboxDialog?.close());

/* Reminder and recurrence */
async function checkReminders() {
  const now = new Date();
  let changed = false;

  for (const t of tasks) {
    if (!t.completed && !t.notified) {
      const when = t.remindAt
        ? new Date(t.remindAt)
        : t.due
        ? new Date(t.due)
        : null;
      if (when && when - now <= 60000 && when - now > -60000) {
        notify(t);
        t.notified = true;
        changed = true;
      }
    }
    // naive recurrence rollover
    if (t.completed && t.repeat && t.due) {
      const d = new Date(t.due);
      if (t.repeat === "daily") d.setDate(d.getDate() + 1);
      if (t.repeat === "weekly") d.setDate(d.getDate() + 7);
      if (t.repeat === "monthly") d.setMonth(d.getMonth() + 1);
      t.completed = false;
      t.status = "pending";
      t.due = d.toISOString();
      t.notified = false;
      changed = true;
    }
  }
  if (changed) {
    await store.set(tasks);
    renderAll();
  }
}

/* Utilities */
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[m] || m;
  });
}

function escapeAttr(s) {
  // For attributes inside double quotes
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/* Keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "k") {
    e.preventDefault();
    els.searchInput?.focus();
  }
  if (e.ctrlKey && e.key === "n") {
    e.preventDefault();
    els.quickAdd?.focus();
  }
});

/* Swipe actions (mobile) */
let touchStartX = 0;
document.addEventListener(
  "touchstart",
  (e) => {
    const li = e.target.closest("li.card");
    if (!li) return;
    touchStartX = e.touches[0]?.clientX || 0;
  },
  { passive: true }
);

document.addEventListener(
  "touchend",
  async (e) => {
    const li = e.target.closest("li.card");
    if (!li) return;
    const endX = e.changedTouches?.[0]?.clientX ?? 0;
    const dx = endX - touchStartX;
    const id = li.dataset.id;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (dx > 80) {
      t.completed = !t.completed;
      t.status = t.completed ? "completed" : "pending";
      await store.set(tasks);
      renderAll();
    }
    if (dx < -80) {
      t.archived = !t.archived;
      await store.set(tasks);
      renderAll();
    }
  },
  { passive: true }
);

/* Click outside dialog to close */
document.addEventListener("click", (e) => {
  document.querySelectorAll("dialog[open]").forEach((d) => {
    const rect = d.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      d.close();
  });
});
