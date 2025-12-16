// --- Data & storage ---
const STORAGE_KEY = 'KienTodoList';
/* JSON format [{id:string,title:string,priority:number,done:boolean,createdAt:number},...] */
const taskListUl = document.getElementById('taskList');
let tasks = [];
let sortDesc = true; // Sort High→Low by default
let editingId = null;

function loadTasks() {
    try {
    const raw = localStorage.getItem(STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
    // normalize any older shapes
    tasks = tasks.map(t => ({
        id: t.id ?? crypto.randomUUID?.() ?? String(Math.random()), //random id for div generate
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

// Save task into local storage
function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// convert priority from text to number value
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
function renderTasks() {
    taskListUl.innerHTML = '';
    tasks.forEach((t, index) => {
    // Create li tag inside the ul tag
    const li = document.createElement('li');
    li.className = 'task';
    li.draggable = true;
    li.dataset.index = String(index);
    li.setAttribute('aria-grabbed', 'false');

    // Create checkbox, if checkbox ticked => call save task and render task again
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.title = 'Mark as done';
    cb.addEventListener('change', () => {
        t.done = cb.checked;
        saveTasks();
        renderTasks();
    });

    // Create div description, if tickbox checked => add class done to styling
    const title = document.createElement('div');
    title.className = 'title' + (t.done ? ' done' : '');
    title.textContent = t.title;

    // Create Priority badge
    const prio = document.createElement('span');
    prio.className = 'prio';
    prio.dataset.priority = String(t.priority);
    prio.textContent = t.priority === 3 ? 'High' : t.priority === 2 ? 'Medium' : 'Low';

    // Create Edit button => if clicked => call open edit dialog
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.className = 'secondary';
    editBtn.addEventListener('click', () => openEditDialog(t.id));

    // Create Delete button => remove from the task array and save task, render again
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

    // Merge 2 button into 1 parent div
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(editBtn, delBtn);

    // Create Drag button
    const dragHandle = document.createElement('span');
    dragHandle.textContent = '↕︎';
    dragHandle.title = 'Drag to reorder';
    dragHandle.style.cursor = 'grab';

    // Merge all created element inside the li tag, calling applyDragEvents for draging interaction => append inside the ul tag
    li.append(cb, title, prio, dragHandle, actions);
    applyDragEvents(li);
    taskListUl.appendChild(li);
    });
}

// Drag & Drop section
let dragFromIndex = null;
// Add event listener for drag and drop animation, styling and calling move task function
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

// re-arrange function in the tasklist object, save and render the ul tag
function moveTask(from, to) {
    const item = tasks.splice(from, 1)[0];
    tasks.splice(to, 0, item);
    saveTasks();
    renderTasks();
}

// Add task section
const newTitleEl = document.getElementById('newTitle');
const newPriorityEl = document.getElementById('newPriority');

document.getElementById('addBtn').addEventListener('click', addTask);

// if press Enter => equal to click on the addTask button
newTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});

// Add task function
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
    // clear the current task input value after add task
    newTitleEl.value = '';
    renderTasks();
}

// Edit section
const dialogEl = document.getElementById('editDialog');
const editTitleEl = document.getElementById('editTitle');
const editPriorityEl = document.getElementById('editPriority');
const editDoneEl = document.getElementById('editDone');

// event listener on click save edit button => update the task value in the local storage
document.getElementById('saveEditBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (!editingId) return dialogEl.close();
    const i = tasks.findIndex(t => t.id === editingId);
    if (i >= 0) {
    tasks[i].title = editTitleEl.value.trim();
    tasks[i].priority = Number(editPriorityEl.value);
    tasks[i].done = editDoneEl.checked;
    saveTasks();
    renderTasks();
    }
    editingId = null;
    dialogEl.close();
});

// open dialog with showModal function, fill the current value inside the modal
function openEditDialog(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    editingId = id;
    editTitleEl.value = t.title;
    editPriorityEl.value = String(t.priority);
    editDoneEl.checked = t.done;
    dialogEl.showModal();
}

// Sorting button
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

// Export button
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

// Import file selection
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

// Import with JSON input
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