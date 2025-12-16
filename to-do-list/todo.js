// --- Data & storage ---
const STORAGE_KEY = 'todoList.v1';
/** @type {{id:string,title:string,priority:number,done:boolean,createdAt:number}[]} */
let tasks = [];
let sortDesc = true; // Sort High→Low by default
let editingId = null;

function loadTasks() {
    try {
    const raw = localStorage.getItem(STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
    // normalize any older shapes
    tasks = tasks.map(t => ({
        id: t.id ?? crypto.randomUUID?.() ?? String(Math.random()),
        title: String(t.title ?? ''),
        priority: normalizePriority(t.priority),
        done: Boolean(t.done),
        createdAt: Number(t.createdAt ?? Date.now())
    }));
    } catch (e) {
    console.warn('Failed to load tasks:', e);
    tasks = [];
    }
}
function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
function normalizePriority(p) {
    // Accept "high|medium|low" or 1/2/3
    if (typeof p === 'string') {
    const s = p.trim().toLowerCase();
    if (s.startsWith('h')) return 3;
    if (s.startsWith('m')) return 2;
    if (s.startsWith('l')) return 1;
    }
    const n = Number(p);
    if ([1,2,3].includes(n)) return n;
    return 2; // default Medium
}

// --- Rendering ---
const taskListEl = document.getElementById('taskList');
function renderTasks() {
    taskListEl.innerHTML = '';
    tasks.forEach((t, index) => {
    const li = document.createElement('li');
    li.className = 'task';
    li.draggable = true;
    li.dataset.index = String(index);
    li.setAttribute('aria-grabbed', 'false');

    // Done checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.title = 'Mark as done';
    cb.addEventListener('change', () => {
        t.done = cb.checked;
        saveTasks();
        renderTasks();
    });

    // Title
    const title = document.createElement('div');
    title.className = 'title' + (t.done ? ' done' : '');
    title.textContent = t.title;

    // Priority badge
    const prio = document.createElement('span');
    prio.className = 'prio';
    prio.dataset.priority = String(t.priority);
    prio.textContent = t.priority === 3 ? 'High' : t.priority === 2 ? 'Medium' : 'Low';

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.className = 'secondary';
    editBtn.addEventListener('click', () => openEditDialog(t.id));

    // Optional delete (not required, but handy)
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => {
        const i = tasks.findIndex(x => x.id === t.id);
                if (i >= 0) {
        tasks.splice(i, 1);
        saveTasks();
        renderTasks();
        }
    });

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(editBtn, delBtn);

    // Drag handle (use the prio badge or the whole row)
    const dragHandle = document.createElement('span');
    dragHandle.textContent = '↕︎';
    dragHandle.title = 'Drag to reorder';
    dragHandle.style.cursor = 'grab';

    li.append(cb, title, prio, dragHandle, actions);
    applyDragEvents(li);
    taskListEl.appendChild(li);
    });
}

// --- Drag & Drop reorder ---
let dragFromIndex = null;
function applyDragEvents(li) {
    li.addEventListener('dragstart', (e) => {
    dragFromIndex = Number(li.dataset.index);
    li.classList.add('dragging');
    li.setAttribute('aria-grabbed', 'true');
    e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    li.setAttribute('aria-grabbed', 'false');
    dragFromIndex = null;
    });
    li.addEventListener('dragover', (e) => {
    e.preventDefault(); // allow drop
    li.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over');
    });
    li.addEventListener('drop', () => {
    li.classList.remove('drag-over');
    const toIndex = Number(li.dataset.index);
    if (dragFromIndex === null || dragFromIndex === toIndex) return;
    moveTask(dragFromIndex, toIndex);
    });
}
function moveTask(from, to) {
    const item = tasks.splice(from, 1)[0];
    tasks.splice(to, 0, item);
    saveTasks();
    renderTasks();
}

// --- Add / Insert row ---
const newTitleEl = document.getElementById('newTitle');
const newPriorityEl = document.getElementById('newPriority');
document.getElementById('addBtn').addEventListener('click', addTask);
newTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});
function addTask() {
    const title = newTitleEl.value.trim();
    const priority = Number(newPriorityEl.value);
    if (!title) {
    newTitleEl.focus();
    return;
    }
    tasks.push({
    id: crypto.randomUUID?.() ?? String(Math.random()),
    title,
    priority,
    done: false,
    createdAt: Date.now()
    });
    saveTasks();
    newTitleEl.value = '';
    renderTasks();
}

// --- Edit dialog ---
const dlg = document.getElementById('editDialog');
const editTitleEl = document.getElementById('editTitle');
const editPriorityEl = document.getElementById('editPriority');
const editDoneEl = document.getElementById('editDone');
document.getElementById('saveEditBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (!editingId) return dlg.close();
    const i = tasks.findIndex(t => t.id === editingId);
    if (i >= 0) {
    tasks[i].title = editTitleEl.value.trim();
    tasks[i].priority = Number(editPriorityEl.value);
    tasks[i].done = editDoneEl.checked;
    saveTasks();
    renderTasks();
    }
    editingId = null;
    dlg.close();
});
function openEditDialog(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    editingId = id;
    editTitleEl.value = t.title;
    editPriorityEl.value = String(t.priority);
    editDoneEl.checked = t.done;
    dlg.showModal();
}

// --- Sort by priority ---
const sortBtn = document.getElementById('sortBtn');
sortBtn.addEventListener('click', () => {
    sortDesc = !sortDesc;
    sortBtn.textContent = sortDesc ? 'Sort: High → Low' : 'Sort: Low → High';
    tasks.sort((a, b) => {
    const d = (b.priority - a.priority);
    return sortDesc ? d : -d;
    });
    saveTasks();
    renderTasks();
});

// --- Export JSON ---
document.getElementById('exportBtn').addEventListener('click', () => {
    const data = JSON.stringify(tasks, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0,19).replace(/[T:]/g,'-');
    a.download = `todo-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    }, 0);
});

// --- Import from file ---
document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
    try {
        const imported = JSON.parse(String(reader.result));
        importTasks(imported);
    } catch (err) {
        alert('Invalid JSON file.');
    }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input
});

// --- Import from pasted text (simple prompt) ---
document.getElementById('importTextBtn').addEventListener('click', () => {
    const raw = prompt('Paste JSON array of tasks or an object containing "tasks":');
    if (!raw) return;
    try {
    const imported = JSON.parse(raw);
    importTasks(imported);
    } catch (err) {
    alert('Invalid JSON.');
    }
});

function importTasks(data) {
    // Accept either an array of tasks, or an object { tasks: [...] }
    const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : null;
    if (!list) {
    alert('JSON must be an array of tasks or { "tasks": [...] }');
    return;
    }
    // Normalize each task
    const normalized = list.map(t => ({
    id: t.id ?? crypto.randomUUID?.() ?? String(Math.random()),
    title: String(t.title ?? ''),
    priority: normalizePriority(t.priority),
    done: Boolean(t.done),
    createdAt: Number(t.createdAt ?? Date.now())
    }));
    tasks = normalized;
    saveTasks();
    renderTasks();
    alert('Import successful.');
}

// --- Boot ---
loadTasks();
renderTasks();