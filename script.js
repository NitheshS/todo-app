let currentFilter = 'all';
let draggedIndex = null;

window.onload = () => {
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark");
    document.getElementById("themeToggle").checked = true;
  }

  renderTasks();
  requestNotificationPermission();
  startDeadlineChecker();
};

function addTask() {
  const taskInput = document.getElementById("taskInput");
  const deadlineInput = document.getElementById("deadlineInput");

  const taskText = taskInput.value.trim();
  const deadline = deadlineInput.value;

  if (taskText === "") return;

  const task = {
    text: taskText,
    completed: false,
    deadline: deadline || null,
    notified: false
  };

  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
  renderTasks();

  taskInput.value = "";
  deadlineInput.value = "";
}

function getTasks() {
  const tasks = localStorage.getItem("tasks");
  return tasks ? JSON.parse(tasks) : [];
}

function saveTasks(tasks) {
  localStorage.setItem("tasks", JSON.stringify(tasks));
}

function setFilter(filter) {
  currentFilter = filter;
  renderTasks();
}

function renderTasks() {
  const taskList = document.getElementById("taskList");
  taskList.innerHTML = "";

  const tasks = getTasks();

  tasks.forEach((task, index) => {
    if (
      currentFilter === 'completed' && !task.completed ||
      currentFilter === 'pending' && task.completed
    ) return;

    const li = document.createElement("li");
    if (task.completed) li.classList.add("completed");
    li.draggable = true;
    li.ondragstart = () => draggedIndex = index;
    li.ondragover = (e) => e.preventDefault();
    li.ondrop = () => swapTasks(index);

    const deadlineText = task.deadline
      ? `<div class="deadline">⏰ ${new Date(task.deadline).toLocaleString()}</div>`
      : "";

    li.innerHTML = `
      <span onclick="toggleTask(${index})">${task.text}</span>
      ${deadlineText}
      <div style="margin-top: 5px;">
        <button onclick="editTask(${index})">✏️ Edit</button>
        <button onclick="deleteTask(${index})">❌ Delete</button>
      </div>
    `;

    taskList.appendChild(li);
  });
}

function toggleTask(index) {
  const tasks = getTasks();
  tasks[index].completed = !tasks[index].completed;
  saveTasks(tasks);
  renderTasks();
}

function deleteTask(index) {
  const tasks = getTasks();
  tasks.splice(index, 1);
  saveTasks(tasks);
  renderTasks();
}

function swapTasks(toIndex) {
  const tasks = getTasks();
  const temp = tasks[draggedIndex];
  tasks[draggedIndex] = tasks[toIndex];
  tasks[toIndex] = temp;
  saveTasks(tasks);
  renderTasks();
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("darkMode", document.body.classList.contains("dark"));
}

// 🔔 Notifications
function requestNotificationPermission() {
  if ("Notification" in window) {
    Notification.requestPermission();
  }
}

function startDeadlineChecker() {
  setInterval(() => {
    const tasks = getTasks();
    const now = new Date();

    let updated = false;
    tasks.forEach((task, i) => {
      if (
        task.deadline &&
        !task.notified &&
        !task.completed &&
        new Date(task.deadline) - now <= 60000 &&
        new Date(task.deadline) - now > 0
      ) {
        showNotification(task.text);
        tasks[i].notified = true;
        updated = true;
      }
    });

    if (updated) saveTasks(tasks);
  }, 30000);
}

function showNotification(text) {
  if (Notification.permission === "granted") {
    new Notification("⏰ Reminder: Task Due Soon!", {
      body: text,
      icon: "https://cdn-icons-png.flaticon.com/512/3448/3448440.png"
    });
  }
}

// ✏️ Edit Task
function editTask(index) {
  const tasks = getTasks();
  const task = tasks[index];

  const newText = prompt("Edit task text:", task.text);
  if (newText !== null && newText.trim() !== "") {
    task.text = newText.trim();
  }

  const newDeadline = prompt("Edit deadline (YYYY-MM-DDTHH:MM):", task.deadline || "");
  if (newDeadline !== null) {
    task.deadline = newDeadline || null;
    task.notified = false;
  }

  tasks[index] = task;
  saveTasks(tasks);
  renderTasks();
}