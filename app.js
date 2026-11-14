'use strict';

const TYPES = [
  { id: 'all', label: 'All lists', icon: '▤' },
  { id: 'pinned', label: 'Pinned', icon: '★' },
  { id: 'Regular Note', label: 'Regular notes', icon: '✎' },
  { id: 'Checklist', label: 'Checklists', icon: '☑' },
  { id: 'Project Note', label: 'Project notes', icon: '▣' },
  { id: 'Daily Log', label: 'Daily logs', icon: '◷' },
  { id: 'Materials', label: 'Materials', icon: '◆' },
  { id: 'Issue', label: 'Issues', icon: '!' }
];

const DB_NAME = 'atlas-notepad';
const DB_VERSION = 1;
const STORE = 'notes';

const state = {
  notes: [],
  activeId: null,
  filter: 'all',
  query: '',
  itemFilter: 'all',
  saveTimer: null,
  installPrompt: null,
  loadingEditor: false
};

const el = id => document.getElementById(id);
const ui = {};
let dbPromise;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  [
    'sidebar', 'scrim', 'menuButton', 'newButton', 'mobileNewButton', 'welcomeNewButton',
    'typeNav', 'searchInput', 'notesList', 'emptyList', 'listTitle', 'listCount',
    'welcome', 'noteEditor', 'titleInput', 'typeInput', 'projectInput', 'tagsInput',
    'bodyInput', 'checklistInput', 'addChecklistButton', 'addItemBottomButton',
    'punchPdfButton', 'itemFilter', 'checklist', 'photoInput',
    'photoGrid', 'saveStatus', 'pinButton', 'saveButton', 'toolbarPdfButton',
    'toolbarDeleteButton', 'moreButton', 'moreMenu', 'duplicateButton', 'shareButton',
    'printButton', 'footerSaveButton', 'footerPdfButton', 'footerDeleteButton',
    'deleteButton', 'backToListButton',
    'updatedLabel', 'installButton', 'backupButton', 'restoreButton', 'restoreInput',
    'offlineDot', 'offlineTitle', 'toast'
  ].forEach(id => ui[id] = el(id));

  buildTypeControls();
  bindEvents();
  updateConnectionStatus();

  try {
    state.notes = (await getAllNotes()).map(normalizeNote);
    sortNotes();
    renderAll();
    if (state.notes.length) openNote(state.notes[0].id, false);
  } catch (error) {
    console.error(error);
    showToast('Could not open offline storage. Check browser privacy settings.');
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.error('Service worker:', error));
  }
}

function buildTypeControls() {
  ui.typeNav.replaceChildren();
  TYPES.forEach(type => {
    const button = document.createElement('button');
    button.dataset.filter = type.id;
    const icon = span(type.icon, 'nav-icon');
    const label = span(type.label, 'nav-label');
    const count = span('0', 'nav-count');
    button.append(icon, label, count);
    button.addEventListener('click', () => {
      state.filter = type.id;
      document.body.classList.remove('menu-open');
      renderAll();
    });
    ui.typeNav.append(button);
  });

  ui.typeInput.replaceChildren();
  TYPES.filter(type => !['all', 'pinned'].includes(type.id)).forEach(type => {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.label.replace(/s$/, '');
    ui.typeInput.append(option);
  });
}

function bindEvents() {
  [ui.newButton, ui.mobileNewButton, ui.welcomeNewButton].forEach(button => button.addEventListener('click', createNote));
  ui.menuButton.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  ui.scrim.addEventListener('click', () => document.body.classList.remove('menu-open'));
  ui.backToListButton.addEventListener('click', () => document.body.classList.remove('editor-open'));

  ui.searchInput.addEventListener('input', event => {
    state.query = event.target.value.trim().toLowerCase();
    renderList();
  });
  ui.notesList.addEventListener('click', event => {
    const card = event.target.closest('.note-card');
    if (card?.dataset.noteId) openNote(card.dataset.noteId);
  });

  [ui.titleInput, ui.typeInput, ui.projectInput, ui.tagsInput, ui.bodyInput].forEach(input => {
    input.addEventListener('input', scheduleSave);
    input.addEventListener('change', scheduleSave);
  });

  ui.pinButton.addEventListener('click', () => {
    const note = activeNote();
    if (!note) return;
    note.pinned = !note.pinned;
    updatePinButton(note);
    scheduleSave();
  });
  ui.saveButton.addEventListener('click', manualSave);
  ui.footerSaveButton.addEventListener('click', manualSave);
  ui.toolbarPdfButton.addEventListener('click', printNote);
  ui.footerPdfButton.addEventListener('click', printNote);
  ui.toolbarDeleteButton.addEventListener('click', deleteActiveNote);
  ui.footerDeleteButton.addEventListener('click', deleteActiveNote);

  ui.addChecklistButton.addEventListener('click', addChecklistItem);
  ui.addItemBottomButton.addEventListener('click', () => {
    ui.checklistInput.focus();
    ui.checklistInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  ui.punchPdfButton.addEventListener('click', printNote);
  ui.itemFilter.addEventListener('click', event => {
    const button = event.target.closest('[data-item-filter]');
    if (!button) return;
    state.itemFilter = button.dataset.itemFilter;
    renderChecklist(activeNote());
  });
  ui.checklistInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addChecklistItem();
    }
  });

  ui.photoInput.addEventListener('change', addPhotos);
  ui.moreButton.addEventListener('click', event => {
    event.stopPropagation();
    ui.moreMenu.hidden = !ui.moreMenu.hidden;
  });
  document.addEventListener('click', event => {
    if (!ui.moreMenu.contains(event.target) && event.target !== ui.moreButton) ui.moreMenu.hidden = true;
  });
  ui.duplicateButton.addEventListener('click', duplicateNote);
  ui.shareButton.addEventListener('click', shareNote);
  ui.printButton.addEventListener('click', printNote);
  ui.deleteButton.addEventListener('click', deleteActiveNote);

  ui.backupButton.addEventListener('click', exportBackup);
  ui.restoreButton.addEventListener('click', () => ui.restoreInput.click());
  ui.restoreInput.addEventListener('change', importBackup);
  ui.installButton.addEventListener('click', installApp);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    ui.installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    ui.installButton.hidden = true;
    showToast('ATLAS Notepad installed');
  });
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.saveTimer) saveActiveNow();
  });
  window.addEventListener('pagehide', () => {
    if (state.saveTimer) saveActiveNow();
  });
  window.addEventListener('beforeunload', () => {
    if (state.saveTimer) saveActiveNow();
  });
}

function createNote() {
  const now = Date.now();
  const selectedType = TYPES.some(type => type.id === state.filter && !['all', 'pinned'].includes(type.id))
    ? state.filter : 'Regular Note';
  const note = {
    id: makeId(),
    title: '',
    body: '',
    type: selectedType,
    project: '',
    tags: '',
    pinned: false,
    checklist: [],
    photos: [],
    createdAt: now,
    updatedAt: now
  };
  state.notes.unshift(note);
  state.activeId = note.id;
  putNote(note);
  renderAll();
  loadEditor(note);
  document.body.classList.add('editor-open');
  document.body.classList.remove('menu-open');
  setTimeout(() => ui.titleInput.focus(), 80);
}

function openNote(id, openMobile = true) {
  if (state.saveTimer) saveActiveNow();
  const note = state.notes.find(item => String(item.id) === String(id));
  if (!note) {
    showToast('Could not open that note. Please refresh and try again.');
    return;
  }
  state.activeId = note.id;
  loadEditor(note);
  renderList();
  if (openMobile) document.body.classList.add('editor-open');
}

function loadEditor(note) {
  state.loadingEditor = true;
  ui.welcome.hidden = true;
  ui.welcome.style.display = 'none';
  ui.noteEditor.hidden = false;
  ui.noteEditor.style.display = 'flex';
  ui.titleInput.value = note.title || '';
  ui.typeInput.value = note.type || 'Regular Note';
  ui.projectInput.value = note.project || '';
  ui.tagsInput.value = note.tags || '';
  ui.bodyInput.value = note.body || '';
  state.itemFilter = 'all';
  updatePinButton(note);
  renderChecklist(note);
  renderPhotos(note);
  ui.updatedLabel.textContent = `Last updated ${formatDate(note.updatedAt || Date.now())}`;
  ui.saveStatus.textContent = 'Saved offline';
  state.loadingEditor = false;
}

function scheduleSave() {
  if (state.loadingEditor || !activeNote()) return;
  ui.saveStatus.textContent = 'Saving…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveActiveNow, 500);
}

async function saveActiveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const note = activeNote();
  if (!note || state.loadingEditor) return;
  note.title = ui.titleInput.value;
  note.type = ui.typeInput.value;
  note.project = ui.projectInput.value;
  note.tags = ui.tagsInput.value;
  note.body = ui.bodyInput.value;
  note.updatedAt = Date.now();
  try {
    await putNote(note);
    sortNotes();
    ui.saveStatus.textContent = 'Saved offline';
    ui.updatedLabel.textContent = `Last updated ${formatDate(note.updatedAt)}`;
    renderList();
    renderNavCounts();
  } catch (error) {
    console.error(error);
    ui.saveStatus.textContent = 'Save failed';
    showToast('Could not save this note');
  }
}

async function manualSave() {
  if (!activeNote()) return;
  await saveActiveNow();
  showToast('Note saved offline');
}

function addChecklistItem() {
  const text = ui.checklistInput.value.trim();
  const note = activeNote();
  if (!text || !note) return;
  note.checklist.push({ id: makeId(), text, done: false, photos: [] });
  ui.checklistInput.value = '';
  state.itemFilter = 'all';
  renderChecklist(note);
  scheduleSave();
  ui.checklistInput.focus();
}

function renderChecklist(note) {
  ui.checklist.replaceChildren();
  if (!note) return;
  const items = note.checklist || [];
  const completed = items.filter(item => item.done).length;
  const filterLabels = { all: 'All', incomplete: 'Incomplete', complete: 'Complete' };
  ui.itemFilter.querySelectorAll('[data-item-filter]').forEach(filterButton => {
    const filter = filterButton.dataset.itemFilter;
    const count = filter === 'all' ? items.length : filter === 'complete' ? completed : items.length - completed;
    filterButton.textContent = `${filterLabels[filter]} (${count})`;
    filterButton.classList.toggle('active', filter === state.itemFilter);
  });

  const visible = items.filter(item => state.itemFilter === 'all' ||
    (state.itemFilter === 'complete' ? item.done : !item.done));
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'punch-empty';
    empty.textContent = items.length ? `No ${state.itemFilter} items.` : 'No punch items yet. Add the first item above.';
    ui.checklist.append(empty);
    return;
  }

  visible.forEach(item => {
    const originalIndex = items.indexOf(item);
    const row = document.createElement('article');
    row.className = `punch-item${item.done ? ' done' : ''}`;

    const number = span(String(originalIndex + 1), 'item-number');
    const photos = document.createElement('div');
    photos.className = 'punch-photos';
    (item.photos || []).forEach(photo => {
      const frame = document.createElement('div');
      frame.className = 'punch-photo';
      const image = document.createElement('img');
      image.src = photo.data;
      image.alt = photo.name || `Photo for item ${originalIndex + 1}`;
      image.addEventListener('click', () => window.open(photo.data, '_blank', 'noopener'));
      const removePhoto = button('×', 'punch-photo-remove');
      removePhoto.setAttribute('aria-label', 'Remove item photo');
      removePhoto.addEventListener('click', () => {
        item.photos = item.photos.filter(entry => entry.id !== photo.id);
        renderChecklist(note);
        scheduleSave();
      });
      frame.append(image, removePhoto);
      photos.append(frame);
    });
    const addPhoto = document.createElement('label');
    addPhoto.className = 'punch-photo-add';
    const plus = document.createElement('strong');
    plus.textContent = '+';
    addPhoto.append(plus, document.createTextNode('Photo'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async event => {
      await addPunchItemPhotos(note, item, [...event.target.files]);
    });
    addPhoto.append(input);
    photos.append(addPhoto);

    const notes = document.createElement('textarea');
    notes.className = 'punch-notes';
    notes.value = item.text || '';
    notes.placeholder = 'Describe the work that must be corrected…';
    notes.addEventListener('input', () => {
      item.text = notes.value;
      scheduleSave();
    });

    const controls = document.createElement('div');
    controls.className = 'punch-item-controls';
    const complete = button('', 'complete-toggle');
    complete.append(span(item.done ? '✓' : '○'), document.createTextNode(item.done ? 'DONE' : 'OPEN'));
    complete.addEventListener('click', () => {
      item.done = !item.done;
      renderChecklist(note);
      scheduleSave();
    });
    const reorder = document.createElement('div');
    reorder.className = 'reorder-buttons';
    const up = button('↑');
    const down = button('↓');
    up.disabled = originalIndex === 0;
    down.disabled = originalIndex === items.length - 1;
    up.addEventListener('click', () => movePunchItem(note, originalIndex, -1));
    down.addEventListener('click', () => movePunchItem(note, originalIndex, 1));
    reorder.append(up, down);
    const removeItem = button('Delete', 'item-delete');
    removeItem.addEventListener('click', () => {
      if (!confirm(`Delete punch item ${originalIndex + 1}?`)) return;
      note.checklist = note.checklist.filter(entry => entry.id !== item.id);
      renderChecklist(note);
      scheduleSave();
    });
    controls.append(complete, reorder, removeItem);
    row.append(number, photos, notes, controls);
    ui.checklist.append(row);
  });
}

function movePunchItem(note, index, direction) {
  const destination = index + direction;
  if (destination < 0 || destination >= note.checklist.length) return;
  const [item] = note.checklist.splice(index, 1);
  note.checklist.splice(destination, 0, item);
  renderChecklist(note);
  scheduleSave();
}

async function addPunchItemPhotos(note, item, files) {
  item.photos = item.photos || [];
  for (const file of files) {
    if (file.size > 6 * 1024 * 1024) {
      showToast(`${file.name} is larger than 6 MB and was skipped`);
      continue;
    }
    try {
      item.photos.push({ id: makeId(), name: file.name, type: file.type, data: await readFileAsDataUrl(file) });
    } catch (error) {
      console.error(error);
      showToast(`Could not attach ${file.name}`);
    }
  }
  renderChecklist(note);
  scheduleSave();
}

async function addPhotos(event) {
  const note = activeNote();
  const files = [...event.target.files];
  event.target.value = '';
  if (!note || !files.length) return;
  for (const file of files) {
    if (file.size > 6 * 1024 * 1024) {
      showToast(`${file.name} is larger than 6 MB and was skipped`);
      continue;
    }
    try {
      const data = await readFileAsDataUrl(file);
      note.photos.push({ id: makeId(), name: file.name, type: file.type, data });
    } catch (error) {
      console.error(error);
      showToast(`Could not attach ${file.name}`);
    }
  }
  renderPhotos(note);
  scheduleSave();
}

function renderPhotos(note) {
  ui.photoGrid.replaceChildren();
  (note.photos || []).forEach(photo => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    const image = document.createElement('img');
    image.src = photo.data;
    image.alt = photo.name || 'Attached photo';
    image.addEventListener('click', () => window.open(photo.data, '_blank', 'noopener'));
    const remove = button('×');
    remove.setAttribute('aria-label', `Remove ${photo.name || 'photo'}`);
    remove.addEventListener('click', () => {
      note.photos = note.photos.filter(item => item.id !== photo.id);
      renderPhotos(note);
      scheduleSave();
    });
    card.append(image, remove);
    ui.photoGrid.append(card);
  });
}

async function duplicateNote() {
  const source = activeNote();
  if (!source) return;
  await saveActiveNow();
  const copy = structuredClone(source);
  copy.id = makeId();
  copy.title = `${source.title || 'Untitled note'} — Copy`;
  copy.pinned = false;
  copy.createdAt = Date.now();
  copy.updatedAt = copy.createdAt;
  copy.checklist = copy.checklist.map(item => ({ ...item, id: makeId() }));
  copy.photos = copy.photos.map(photo => ({ ...photo, id: makeId() }));
  state.notes.unshift(copy);
  await putNote(copy);
  ui.moreMenu.hidden = true;
  openNote(copy.id);
  renderAll();
  showToast('Note duplicated');
}

async function deleteActiveNote() {
  const note = activeNote();
  if (!note || !confirm(`Delete “${note.title || 'Untitled note'}”? This cannot be undone.`)) return;
  await deleteNoteFromDb(note.id);
  state.notes = state.notes.filter(item => item.id !== note.id);
  state.activeId = null;
  ui.moreMenu.hidden = true;
  ui.noteEditor.hidden = true;
  ui.noteEditor.style.display = 'none';
  ui.welcome.hidden = false;
  ui.welcome.style.display = 'flex';
  document.body.classList.remove('editor-open');
  renderAll();
  if (state.notes.length && innerWidth > 900) openNote(filteredNotes()[0]?.id || state.notes[0].id, false);
  showToast('Note deleted');
}

async function shareNote() {
  const note = activeNote();
  if (!note) return;
  await saveActiveNow();
  const text = noteAsText(note);
  try {
    if (navigator.share) await navigator.share({ title: note.title || 'ATLAS Note', text });
    else {
      await navigator.clipboard.writeText(text);
      showToast('Note copied to clipboard');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Could not share this note');
  }
  ui.moreMenu.hidden = true;
}

async function printNote() {
  if (!activeNote()) return;
  await saveActiveNow();
  ui.moreMenu.hidden = true;
  const oldHeight = ui.bodyInput.style.height;
  const punchTextareas = [...document.querySelectorAll('.punch-notes')];
  const oldPunchHeights = punchTextareas.map(textarea => textarea.style.height);
  ui.bodyInput.style.height = `${ui.bodyInput.scrollHeight}px`;
  punchTextareas.forEach(textarea => textarea.style.height = `${textarea.scrollHeight}px`);
  showToast('In the print screen, choose Save as PDF');
  setTimeout(() => {
    window.print();
    ui.bodyInput.style.height = oldHeight;
    punchTextareas.forEach((textarea, index) => textarea.style.height = oldPunchHeights[index]);
  }, 250);
}

function noteAsText(note) {
  const lines = [note.title || 'Untitled note', note.type];
  if (note.project) lines.push(`Project: ${note.project}`);
  if (note.tags) lines.push(`Tags: ${note.tags}`);
  if (note.body) lines.push('', note.body);
  if (note.checklist?.length) {
    lines.push('', 'Punch List:');
    note.checklist.forEach((item, index) => {
      const photoCount = item.photos?.length ? ` (${item.photos.length} photo${item.photos.length === 1 ? '' : 's'})` : '';
      lines.push(`${index + 1}. ${item.done ? '☑' : '☐'} ${item.text}${photoCount}`);
    });
  }
  return lines.join('\n');
}

function renderAll() {
  renderNavCounts();
  renderList();
}

function renderNavCounts() {
  ui.typeNav.querySelectorAll('button').forEach(button => {
    const filter = button.dataset.filter;
    button.classList.toggle('active', filter === state.filter);
    const count = filter === 'all'
      ? state.notes.length
      : filter === 'pinned'
        ? state.notes.filter(note => note.pinned).length
        : state.notes.filter(note => note.type === filter).length;
    button.querySelector('.nav-count').textContent = count;
  });
}

function renderList() {
  const notes = filteredNotes();
  const type = TYPES.find(item => item.id === state.filter);
  ui.listTitle.textContent = type?.label || 'All notes';
  ui.listCount.textContent = `${notes.length} ${notes.length === 1 ? 'list' : 'lists'}`;
  ui.notesList.replaceChildren();
  ui.emptyList.hidden = notes.length > 0;

  notes.forEach(note => {
    const card = document.createElement('article');
    card.className = `note-card${note.id === state.activeId ? ' active' : ''}`;
    card.dataset.noteId = String(note.id);
    const head = document.createElement('div');
    head.className = 'note-card-head';
    if (note.pinned) head.append(span('★', 'pin-star'));
    const title = document.createElement('h2');
    title.textContent = note.title.trim() || 'Untitled list';
    head.append(title, span(note.type, 'type-pill'));

    const preview = document.createElement('p');
    preview.className = 'preview';
    const completed = (note.checklist || []).filter(item => item.done).length;
    preview.textContent = note.body.trim() || (note.checklist?.length
      ? `${completed} of ${note.checklist.length} checklist items complete`
      : 'Empty note');

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    if (note.project) meta.append(span(note.project));
    meta.append(span(formatCompactDate(note.updatedAt)));
    if (note.photos?.length) meta.append(span(`${note.photos.length} photo${note.photos.length === 1 ? '' : 's'}`));
    card.append(head, preview, meta);
    ui.notesList.append(card);
  });
}

function filteredNotes() {
  return state.notes.filter(note => {
    const typeMatch = state.filter === 'all' ||
      (state.filter === 'pinned' ? note.pinned : note.type === state.filter);
    if (!typeMatch) return false;
    if (!state.query) return true;
    return [note.title, note.body, note.project, note.tags, note.type]
      .join(' ').toLowerCase().includes(state.query);
  });
}

function updatePinButton(note) {
  ui.pinButton.textContent = note.pinned ? '★ Pinned' : '☆ Pin';
  ui.pinButton.classList.toggle('is-pinned', note.pinned);
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  ui.offlineDot.classList.toggle('offline', !online);
  ui.offlineTitle.textContent = online ? 'Offline ready' : 'Working offline';
}

async function installApp() {
  if (!state.installPrompt) {
    showToast('Use your browser menu and choose Add to Home screen');
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  ui.installButton.hidden = true;
}

function exportBackup() {
  const payload = {
    app: 'ATLAS Notepad',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: state.notes
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `ATLAS-Notepad-Backup-${new Date().toISOString().slice(0, 10)}.json`);
  showToast('Backup exported');
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.notes)) throw new Error('Invalid backup');
    const choice = confirm(`Import ${payload.notes.length} notes? This will replace the notes currently on this device.`);
    if (!choice) return;
    await replaceAllNotes(payload.notes);
    state.notes = payload.notes;
    state.activeId = null;
    sortNotes();
    renderAll();
    if (state.notes.length) openNote(state.notes[0].id, false);
    else {
      ui.noteEditor.hidden = true;
      ui.noteEditor.style.display = 'none';
      ui.welcome.hidden = false;
      ui.welcome.style.display = 'flex';
    }
    showToast('Backup restored');
  } catch (error) {
    console.error(error);
    showToast('That file is not a valid ATLAS Notepad backup');
  }
}

function normalizeNote(note) {
  const now = Date.now();
  return {
    id: note.id || makeId(),
    title: note.title || '',
    body: note.body || '',
    type: note.type || 'Regular Note',
    project: note.project || '',
    tags: note.tags || '',
    pinned: !!note.pinned,
    checklist: Array.isArray(note.checklist) ? note.checklist.map(item => ({
      id: item.id || makeId(),
      text: item.text || '',
      done: !!item.done,
      photos: Array.isArray(item.photos) ? item.photos : []
    })) : [],
    photos: Array.isArray(note.photos) ? note.photos : [],
    createdAt: note.createdAt || now,
    updatedAt: note.updatedAt || note.createdAt || now
  };
}

function activeNote() { return state.notes.find(note => String(note.id) === String(state.activeId)); }
function sortNotes() { state.notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt); }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function span(text, className = '') { const node = document.createElement('span'); node.textContent = text; node.className = className; return node; }
function button(text, className = '') { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.className = className; return node; }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatCompactDate(value) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)); }
function readFileAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function showToast(message) { ui.toast.textContent = message; ui.toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => ui.toast.classList.remove('show'), 2600); }

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getAllNotes() {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putNote(note) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(note);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteNoteFromDb(id) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function replaceAllNotes(notes) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.clear();
    notes.forEach(note => store.put(note));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
