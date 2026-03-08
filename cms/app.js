/* ── nomnompewpew CDN Asset Manager — app.js ────────────── */
'use strict';

// ── Constants ─────────────────────────────────────────────
const DEFAULT_OWNER  = 'nomnompewpew';
const DEFAULT_REPO   = 'nomnompewpewCDN';
const DEFAULT_BRANCH = 'main';

const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.avif','.ico','.bmp']);
const VIDEO_EXTS = new Set(['.mp4','.webm','.mov','.ogg','.m4v','.ogv']);
const AUDIO_EXTS = new Set(['.mp3','.wav','.flac','.aac','.m4a','.opus']);
const DATA_EXTS  = new Set(['.json','.yaml','.yml','.xml','.csv','.toml']);
const FONT_EXTS  = new Set(['.woff','.woff2','.ttf','.otf','.eot']);
const CSS_EXTS   = new Set(['.css','.scss','.sass','.less']);
const JS_EXTS    = new Set(['.js','.mjs','.ts','.jsx','.tsx']);

const HIDDEN_FILES = new Set(['.gitkeep','.DS_Store','.gitignore','.gitattributes']);
const HIDDEN_DIRS  = new Set(['node_modules','.git','.github','scripts','.cache','dist']);

// ── State ─────────────────────────────────────────────────
const S = {
  token:       '',
  owner:       DEFAULT_OWNER,
  repo:        DEFAULT_REPO,
  branch:      DEFAULT_BRANCH,
  path:        '',          // current directory path
  items:       [],          // items in current directory
  selected:    new Set(),   // selected file paths
  viewMode:    'grid',
  filter:      '',
  treeCache:   new Map(),   // path → dir items[]
  treeExpanded: new Set(),
  copyFolderPath:   null,
  copyFolderFormat: 'cdn',
  deleteTarget: null,
};

// ── GitHub API ────────────────────────────────────────────
const api = {
  get base() { return `https://api.github.com/repos/${S.owner}/${S.repo}`; },
  get hdrs() {
    const h = { Accept: 'application/vnd.github.v3+json' };
    if (S.token) h.Authorization = `Bearer ${S.token}`;
    return h;
  },

  async getContents(path) {
    const p = path ? `/${encodeURIComponent(path).replace(/%2F/g,'/')}` : '';
    const res = await fetch(`${this.base}/contents${p}?ref=${S.branch}`, { headers: this.hdrs });
    if (res.status === 401) throw Object.assign(new Error('UNAUTHORIZED'), { code: 401 });
    if (res.status === 404) throw Object.assign(new Error('NOT_FOUND'),    { code: 404 });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    return res.json();
  },

  async putFile(path, b64content, message, sha = null) {
    const body = { message, content: b64content, branch: S.branch };
    if (sha) body.sha = sha;
    const res = await fetch(`${this.base}/contents/${path}`, {
      method:  'PUT',
      headers: { ...this.hdrs, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed (${res.status})`);
    }
    return res.json();
  },

  async deleteFile(path, sha, message) {
    const res = await fetch(`${this.base}/contents/${path}`, {
      method:  'DELETE',
      headers: { ...this.hdrs, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, sha, branch: S.branch }),
    });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    return res.json();
  },

  async getFileMeta(path) {
    const res = await fetch(`${this.base}/contents/${path}?ref=${S.branch}`, { headers: this.hdrs });
    if (!res.ok) throw new Error(`File not found (${res.status})`);
    return res.json();
  },
};

// ── URL helpers ───────────────────────────────────────────
function cdnUrl(path)  { return `https://cdn.jsdelivr.net/gh/${S.owner}/${S.repo}@${S.branch}/${path}`; }
function rawUrl(path)  { return `https://raw.githubusercontent.com/${S.owner}/${S.repo}/${S.branch}/${path}`; }
function pathFor(item) { return item.path; }

function formatPaths(items, fmt) {
  return items.map(i => {
    switch (fmt) {
      case 'cdn':      return cdnUrl(i.path);
      case 'raw':      return rawUrl(i.path);
      case 'path':     return i.path;
      case 'filename': return i.name;
      default:         return i.path;
    }
  }).join('\n');
}

// ── File classification ───────────────────────────────────
function fileExt(name)  { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; }
function fileKind(name) {
  const e = fileExt(name);
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (DATA_EXTS.has(e))  return 'data';
  if (FONT_EXTS.has(e))  return 'font';
  if (CSS_EXTS.has(e))   return 'css';
  if (JS_EXTS.has(e))    return 'js';
  return 'file';
}
const KIND_ICON = { image:'🖼', video:'🎬', audio:'🎵', data:'📋', font:'🔤', css:'🎨', js:'⚙️', file:'📄', dir:'📁' };
function itemIcon(item) { return item.type === 'dir' ? '📁' : (KIND_ICON[fileKind(item.name)] || '📄'); }
function typeLabel(item) {
  if (item.type === 'dir') return 'Folder';
  const e = fileExt(item.name);
  return e ? e.slice(1).toUpperCase() : 'File';
}
function fmtSize(b) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function isHidden(item) {
  return item.type === 'dir' ? HIDDEN_DIRS.has(item.name) : HIDDEN_FILES.has(item.name);
}

// ── Utilities ─────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
  });
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return  1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// ── Clipboard ─────────────────────────────────────────────
function copyText(text, label = 'Copied!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast(label, 'success'));
  } else {
    const t = Object.assign(document.createElement('textarea'), {
      value: text, style: 'position:fixed;opacity:0',
    });
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
    toast(label, 'success');
  }
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info', durationMs = 3000) {
  const el = Object.assign(document.createElement('div'), {
    className: `toast ${type}`,
    textContent: msg,
  });
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

// ── Settings ──────────────────────────────────────────────
function loadSettings() {
  S.token  = localStorage.getItem('cdn_token')  || '';
  S.owner  = localStorage.getItem('cdn_owner')  || DEFAULT_OWNER;
  S.repo   = localStorage.getItem('cdn_repo')   || DEFAULT_REPO;
  S.branch = localStorage.getItem('cdn_branch') || DEFAULT_BRANCH;
  S.viewMode = localStorage.getItem('cdn_view') || 'grid';
}
function saveSettings() {
  localStorage.setItem('cdn_token',  S.token);
  localStorage.setItem('cdn_owner',  S.owner);
  localStorage.setItem('cdn_repo',   S.repo);
  localStorage.setItem('cdn_branch', S.branch);
  localStorage.setItem('cdn_view',   S.viewMode);
}

// ── Navigation ────────────────────────────────────────────
async function navigateTo(path) {
  path = path.replace(/^\/+|\/+$/g, '');
  S.path = path;
  S.selected.clear();
  S.filter = '';
  document.getElementById('search-input').value = '';
  renderBreadcrumb();
  renderSelectionBar();
  updateSidebarActive();
  await loadDirectory(path);
}

async function loadDirectory(path) {
  setFileArea(`<div class="loading"><div class="spinner"></div> Loading…</div>`);
  try {
    let raw = await api.getContents(path);
    if (!Array.isArray(raw)) raw = [raw];
    S.items = sortItems(raw.filter(i => !isHidden(i)));
    renderFiles();
  } catch (err) {
    if (err.code === 401) {
      setFileArea(tokenWarningHtml());
    } else {
      setFileArea(`<div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Error</h3>
        <p>${esc(err.message)}</p>
      </div>`);
    }
  }
}

function setFileArea(html) {
  document.getElementById('file-area').innerHTML = html;
}

function tokenWarningHtml() {
  return `<div class="token-warning">
    <div class="token-warning-icon">🔑</div>
    <h2>GitHub Token Required</h2>
    <p>Enter your GitHub Personal Access Token in Settings to browse and manage CDN assets.</p>
    <button class="btn btn-primary" style="margin-top:4px" onclick="openSettings()">Open Settings</button>
  </div>`;
}

// ── Breadcrumb ────────────────────────────────────────────
function renderBreadcrumb() {
  const parts = S.path ? S.path.split('/') : [];
  let html = `<button class="bc-item${parts.length === 0 ? ' current' : ''}" onclick="navigateTo('')">root</button>`;
  let built = '';
  parts.forEach((part, i) => {
    built = built ? `${built}/${part}` : part;
    const captured = built;
    const isCurrent = i === parts.length - 1;
    html += `<span class="bc-sep">/</span>
      <button class="bc-item${isCurrent ? ' current' : ''}"
        onclick="navigateTo('${esc(captured)}')">${esc(part)}</button>`;
  });
  document.getElementById('breadcrumb').innerHTML = html;
}

// ── Sidebar Folder Tree ───────────────────────────────────
async function initFolderTree() {
  const el = document.getElementById('folder-tree');
  el.innerHTML = `<div class="loading" style="padding:14px 0"><div class="spinner" style="width:14px;height:14px;border-width:1.5px"></div></div>`;
  document.getElementById('sidebar-repo-label').textContent = `${S.owner}/${S.repo}`;
  try {
    let raw = await api.getContents('');
    if (!Array.isArray(raw)) raw = [];
    const dirs = sortItems(raw.filter(i => i.type === 'dir' && !isHidden(i)));
    S.treeCache.set('', dirs);
    el.innerHTML = renderTreeNodes(dirs);
    bindTreeEvents(el);
  } catch {
    el.innerHTML = `<div style="padding:12px 14px;font-size:.75rem;opacity:.5">Could not load folders</div>`;
  }
}

function renderTreeNodes(dirs) {
  return dirs.map(dir => {
    const p = dir.path;
    const isOpen   = S.treeExpanded.has(p);
    const isActive = S.path === p || S.path.startsWith(p + '/');
    return `<div class="tree-node" data-path="${esc(p)}">
      <div class="tree-row${isActive ? ' active' : ''}" data-nav="${esc(p)}">
        <span class="tree-toggle${isOpen ? ' open' : ''}" data-toggle="${esc(p)}">▶</span>
        <span class="tree-icon">📁</span>
        <span class="tree-label" title="${esc(p)}">${esc(dir.name)}</span>
        <button class="tree-copy" data-copy-folder="${esc(p)}" title="Copy all paths in this folder">⎘</button>
      </div>
      <div class="tree-children${isOpen ? '' : ' hidden'}" data-children="${esc(p)}"></div>
    </div>`;
  }).join('');
}

function bindTreeEvents(container) {
  container.addEventListener('click', async e => {
    // Copy folder button
    const copyBtn = e.target.closest('[data-copy-folder]');
    if (copyBtn) { e.stopPropagation(); openCopyFolderModal(copyBtn.dataset.copyFolder); return; }

    // Expand/collapse toggle
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) { e.stopPropagation(); await toggleTreeNode(toggle.dataset.toggle, container); return; }

    // Navigate
    const row = e.target.closest('[data-nav]');
    if (row) navigateTo(row.dataset.nav);
  });
}

async function toggleTreeNode(path, container) {
  const isOpen = S.treeExpanded.has(path);
  const toggleEl   = container.querySelector(`[data-toggle="${CSS.escape(path)}"]`);
  const childrenEl = container.querySelector(`[data-children="${CSS.escape(path)}"]`);

  if (isOpen) {
    S.treeExpanded.delete(path);
    toggleEl?.classList.remove('open');
    childrenEl?.classList.add('hidden');
    return;
  }

  S.treeExpanded.add(path);
  toggleEl?.classList.add('open');
  if (!childrenEl) return;

  if (!S.treeCache.has(path)) {
    childrenEl.innerHTML = `<div style="padding:5px 8px"><div class="spinner" style="width:11px;height:11px;border-width:1.5px;margin:2px auto"></div></div>`;
    try {
      let raw = await api.getContents(path);
      if (!Array.isArray(raw)) raw = [];
      const dirs = sortItems(raw.filter(i => i.type === 'dir' && !isHidden(i)));
      S.treeCache.set(path, dirs);
    } catch { S.treeCache.set(path, []); }
  }

  const kids = S.treeCache.get(path) || [];
  childrenEl.innerHTML = kids.length ? renderTreeNodes(kids) : '';
  childrenEl.classList.remove('hidden');
  if (kids.length) bindTreeEvents(childrenEl);
}

function updateSidebarActive() {
  document.querySelectorAll('.tree-row[data-nav]').forEach(row => {
    const p = row.dataset.nav;
    row.classList.toggle('active', S.path === p || S.path.startsWith(p + '/'));
  });
}

// ── Render Files ──────────────────────────────────────────
function renderFiles() {
  const items = S.filter
    ? S.items.filter(i => i.name.toLowerCase().includes(S.filter.toLowerCase()))
    : S.items;

  if (items.length === 0) {
    const empty = S.filter
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><h3>No Results</h3><p>No files match <em>"${esc(S.filter)}"</em></p></div>`
      : `<div class="empty-state"><div class="empty-icon">📂</div><h3>Empty Folder</h3>
          <p>Drop files here or click Upload to add assets.</p>
          <button class="btn btn-primary" style="margin-top:6px" onclick="openUploadModal()">Upload Files</button>
         </div>`;
    setFileArea(empty);
    return;
  }

  if (S.viewMode === 'list') renderListView(items);
  else renderGridView(items);
}

// ── Grid ──────────────────────────────────────────────────
function renderGridView(items) {
  setFileArea(`<div class="file-grid">${items.map(gridCard).join('')}</div>`);

  // Lazy-load image thumbnails
  document.querySelectorAll('[data-lazy-src]').forEach(img => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          img.src = img.dataset.lazySrc;
          obs.disconnect();
        }
      });
    }, { rootMargin: '60px' });
    obs.observe(img);
  });

  // Events
  document.querySelectorAll('.file-card').forEach(card => {
    const item = S.items.find(i => i.path === card.dataset.path);
    if (!item) return;

    card.addEventListener('click', e => {
      if (e.target.closest('.card-checkbox,.card-copy')) return;
      item.type === 'dir' ? navigateTo(item.path) : toggleSelect(item.path);
    });
    card.querySelector('.card-checkbox')?.addEventListener('click', e => {
      e.stopPropagation(); toggleSelect(item.path);
    });
    card.querySelector('.card-copy')?.addEventListener('click', e => {
      e.stopPropagation(); copyText(cdnUrl(item.path), `Copied ${item.name}`);
    });
    card.addEventListener('contextmenu', e => {
      e.preventDefault(); showContextMenu(e, item);
    });
  });
}

function gridCard(item) {
  const isDir    = item.type === 'dir';
  const isImg    = !isDir && fileKind(item.name) === 'image';
  const selected = S.selected.has(item.path);

  let preview;
  if (isDir) {
    preview = `<div class="card-preview folder-preview"><span class="file-type-icon">📁</span></div>`;
  } else if (isImg) {
    preview = `<div class="card-preview image-preview">
      <img data-lazy-src="${esc(rawUrl(item.path))}" alt="${esc(item.name)}"
           onerror="this.parentElement.innerHTML='<span class=\\'file-type-icon\\'>🖼</span>'" />
    </div>`;
  } else {
    preview = `<div class="card-preview"><span class="file-type-icon">${itemIcon(item)}</span></div>`;
  }

  return `<div class="file-card${selected ? ' selected' : ''}" data-path="${esc(item.path)}">
    <div class="card-checkbox" title="${selected ? 'Deselect' : 'Select'}"></div>
    ${!isDir ? `<button class="card-copy" title="Copy CDN URL">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg> CDN</button>` : ''}
    ${preview}
    <div class="card-body">
      <span class="card-name" title="${esc(item.path)}">${esc(item.name)}</span>
    </div>
    ${!isDir ? `<div class="card-meta">${typeLabel(item)}${item.size ? ' · ' + fmtSize(item.size) : ''}</div>` : ''}
  </div>`;
}

// ── List ──────────────────────────────────────────────────
function renderListView(items) {
  const rows = items.map(item => {
    const isDir    = item.type === 'dir';
    const selected = S.selected.has(item.path);
    return `<div class="list-row${selected ? ' selected' : ''}" data-path="${esc(item.path)}">
      <div class="row-cb${selected ? ' checked' : ''}"></div>
      <div class="row-name">
        <span class="row-icon">${itemIcon(item)}</span>
        <span class="row-filename" title="${esc(item.path)}">${esc(item.name)}</span>
      </div>
      <span class="row-type">${typeLabel(item)}</span>
      <span class="row-size">${!isDir ? fmtSize(item.size) : '—'}</span>
      <div class="row-actions">
        ${!isDir ? `
          <button class="row-copy-btn" data-action="copy-cdn"  title="Copy CDN URL">CDN URL</button>
          <button class="row-copy-btn" data-action="copy-path" title="Copy path">Path</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');

  setFileArea(`<div class="file-list">
    <div class="list-header"><div></div><div>Name</div><div>Type</div><div>Size</div><div>Actions</div></div>
    ${rows}
  </div>`);

  document.querySelectorAll('.list-row').forEach(row => {
    const item = S.items.find(i => i.path === row.dataset.path);
    if (!item) return;

    row.addEventListener('click', e => {
      if (e.target.closest('.row-cb,.row-copy-btn')) return;
      item.type === 'dir' ? navigateTo(item.path) : toggleSelect(item.path);
    });
    row.querySelector('.row-cb')?.addEventListener('click', e => {
      e.stopPropagation(); toggleSelect(item.path);
    });
    row.querySelector('[data-action="copy-cdn"]')?.addEventListener('click', e => {
      e.stopPropagation(); copyText(cdnUrl(item.path), `Copied ${item.name}`);
    });
    row.querySelector('[data-action="copy-path"]')?.addEventListener('click', e => {
      e.stopPropagation(); copyText(item.path, 'Copied path');
    });
    row.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e, item); });
  });
}

// ── Selection ─────────────────────────────────────────────
function toggleSelect(path) {
  S.selected.has(path) ? S.selected.delete(path) : S.selected.add(path);
  renderSelectionBar();
  // Update card
  const card = document.querySelector(`.file-card[data-path="${CSS.escape(path)}"]`);
  if (card) {
    card.classList.toggle('selected', S.selected.has(path));
    const cb = card.querySelector('.card-checkbox');
    if (cb) cb.title = S.selected.has(path) ? 'Deselect' : 'Select';
  }
  // Update list row
  const row = document.querySelector(`.list-row[data-path="${CSS.escape(path)}"]`);
  if (row) {
    row.classList.toggle('selected', S.selected.has(path));
    row.querySelector('.row-cb')?.classList.toggle('checked', S.selected.has(path));
  }
}

function selectAll() {
  S.items.filter(i => i.type !== 'dir').forEach(i => S.selected.add(i.path));
  renderFiles();
  renderSelectionBar();
}

function clearSelection() {
  S.selected.clear();
  renderSelectionBar();
  renderFiles();
}

function renderSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const n   = S.selected.size;
  if (n === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('selection-count').textContent = `${n} file${n === 1 ? '' : 's'} selected`;
}

// ── Context Menu ──────────────────────────────────────────
let _ctxMenu = null;

function showContextMenu(e, item) {
  removeContextMenu();
  const isFile = item.type !== 'dir';
  const menu   = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = isFile ? `
    <button class="ctx-item" data-action="copy-cdn">🔗 Copy CDN URL</button>
    <button class="ctx-item" data-action="copy-raw">🔗 Copy Raw URL</button>
    <button class="ctx-item" data-action="copy-path">📁 Copy Relative Path</button>
    <button class="ctx-item" data-action="copy-name">📄 Copy Filename</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item" data-action="open">↗ Open in new tab</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item danger" data-action="delete">🗑 Delete</button>
  ` : `
    <button class="ctx-item" data-action="open-dir">📂 Open Folder</button>
    <button class="ctx-item" data-action="copy-folder">📋 Copy All CDN URLs</button>
    <button class="ctx-item" data-action="copy-folder-paths">📋 Copy All Paths</button>
  `;
  menu.style.left = `${Math.min(e.clientX, innerWidth  - 210)}px`;
  menu.style.top  = `${Math.min(e.clientY, innerHeight - 220)}px`;
  document.body.appendChild(menu);
  _ctxMenu = menu;

  menu.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    removeContextMenu();
    switch (btn.dataset.action) {
      case 'copy-cdn':          copyText(cdnUrl(item.path), `Copied CDN URL`); break;
      case 'copy-raw':          copyText(rawUrl(item.path), `Copied raw URL`); break;
      case 'copy-path':         copyText(item.path, `Copied path`); break;
      case 'copy-name':         copyText(item.name, `Copied filename`); break;
      case 'open':              window.open(rawUrl(item.path), '_blank'); break;
      case 'open-dir':          navigateTo(item.path); break;
      case 'copy-folder':       openCopyFolderModal(item.path, 'cdn'); break;
      case 'copy-folder-paths': openCopyFolderModal(item.path, 'path'); break;
      case 'delete':            openDeleteModal(item); break;
    }
  });

  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
}

function removeContextMenu() {
  _ctxMenu?.remove();
  _ctxMenu = null;
}

// ── Modals ────────────────────────────────────────────────
function openModal(id) {
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  const anyOpen = [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'));
  if (!anyOpen) document.getElementById('modal-backdrop').classList.add('hidden');
}
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-backdrop').classList.add('hidden');
}

// Settings
function openSettings() {
  const f = document.getElementById('settings-form');
  f.token.value  = S.token;
  f.owner.value  = S.owner;
  f.repo.value   = S.repo;
  f.branch.value = S.branch;
  openModal('modal-settings');
}
function saveSettingsFromForm() {
  const f   = document.getElementById('settings-form');
  const prev = { token: S.token, owner: S.owner, repo: S.repo, branch: S.branch };
  S.token  = f.token.value.trim();
  S.owner  = f.owner.value.trim()  || DEFAULT_OWNER;
  S.repo   = f.repo.value.trim()   || DEFAULT_REPO;
  S.branch = f.branch.value.trim() || DEFAULT_BRANCH;
  saveSettings();
  closeAllModals();
  toast('Settings saved', 'success');
  const changed = prev.token !== S.token || prev.owner !== S.owner || prev.repo !== S.repo || prev.branch !== S.branch;
  if (changed) {
    S.treeCache.clear();
    S.treeExpanded.clear();
    initFolderTree();
    navigateTo('');
  }
}

// New Folder
function openNewFolderModal() {
  document.getElementById('new-folder-input').value = '';
  updateFolderPathPreview();
  openModal('modal-new-folder');
  setTimeout(() => document.getElementById('new-folder-input').focus(), 60);
}
function updateFolderPathPreview() {
  const name = document.getElementById('new-folder-input').value.trim();
  const base = S.path ? `${S.path}/` : '';
  document.getElementById('new-folder-path-preview').textContent =
    name ? `Will create: ${base}${name}/` : '';
}
async function createFolder() {
  const name = document.getElementById('new-folder-input').value.trim();
  if (!name) { toast('Please enter a folder name', 'error'); return; }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    toast('Name may only contain letters, numbers, hyphens, underscores, dots', 'error');
    return;
  }
  const folderPath = S.path ? `${S.path}/${name}` : name;
  const keepPath   = `${folderPath}/.gitkeep`;
  closeAllModals();
  try {
    await api.putFile(keepPath, '', `feat: create folder ${folderPath}`);
    toast(`Folder "${name}" created`, 'success');
    S.treeCache.delete(S.path);
    S.treeCache.delete('');
    await loadDirectory(S.path);
    initFolderTree();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// Delete
function openDeleteModal(item) {
  S.deleteTarget = item;
  document.getElementById('delete-filename').textContent = item.name;
  document.getElementById('delete-branch-label').textContent = S.branch;
  openModal('modal-delete');
}
async function confirmDelete() {
  const item = S.deleteTarget;
  if (!item) return;
  S.deleteTarget = null;
  closeAllModals();

  if (item.type === 'dir') {
    toast('Folder deletion requires removing each file individually. Use GitHub.com to delete a folder tree.', 'info', 5000);
    return;
  }
  try {
    let sha = item.sha;
    if (!sha) { const meta = await api.getFileMeta(item.path); sha = meta.sha; }
    await api.deleteFile(item.path, sha, `chore: delete ${item.path}`);
    toast(`Deleted "${item.name}"`, 'success');
    S.items = S.items.filter(i => i.path !== item.path);
    renderFiles();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// Upload
function openUploadModal() {
  if (!S.uploadQueuePersist) S.uploadQueue = [];
  S.uploadQueuePersist = false;
  renderUploadQueue();
  document.getElementById('upload-destination-path').textContent = S.path ? `/${S.path}/` : '/';
  document.getElementById('upload-progress-bar').classList.add('hidden');
  document.getElementById('upload-progress-fill').style.width = '0%';
  const startBtn = document.getElementById('upload-start-btn');
  startBtn.disabled = false;
  startBtn.textContent = 'Upload All';
  openModal('modal-upload');
}
function renderUploadQueue() {
  const list = document.getElementById('upload-queue-list');
  if (!S.uploadQueue || S.uploadQueue.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = S.uploadQueue.map((item, i) => {
    const statusMap = { pending: 'Pending', uploading: 'Uploading…', done: '✓ Done', error: `✗ ${item.error || 'Error'}` };
    return `<div class="upload-item">
      <span class="upload-item-name" title="${esc(item.file.name)}">${esc(item.file.name)}</span>
      <span class="upload-item-size">${fmtSize(item.file.size)}</span>
      <span class="upload-item-status ${item.status}">${statusMap[item.status] || item.status}</span>
      ${item.status === 'pending' ? `<button class="upload-remove" data-remove="${i}">✕</button>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.uploadQueue.splice(parseInt(btn.dataset.remove), 1);
      renderUploadQueue();
    });
  });
}

async function startUpload() {
  if (!S.token) { toast('Set your GitHub token in Settings first', 'error'); return; }
  const pending = (S.uploadQueue || []).filter(i => i.status === 'pending');
  if (!pending.length) { closeAllModals(); await loadDirectory(S.path); return; }

  const total = pending.length;
  let done = 0;
  const progressBar  = document.getElementById('upload-progress-bar');
  const progressFill = document.getElementById('upload-progress-fill');
  const startBtn     = document.getElementById('upload-start-btn');

  progressBar.classList.remove('hidden');
  startBtn.disabled    = true;
  startBtn.textContent = `Uploading 0 / ${total}…`;

  for (const item of pending) {
    item.status = 'uploading';
    renderUploadQueue();
    try {
      const b64 = await fileToBase64(item.file);
      const targetPath = S.path ? `${S.path}/${item.file.name}` : item.file.name;
      let sha = null;
      try { const ex = await api.getFileMeta(targetPath); sha = ex.sha; } catch { /* new file */ }
      await api.putFile(targetPath, b64, `feat: upload ${targetPath}`, sha);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error  = err.message;
    }
    done++;
    renderUploadQueue();
    progressFill.style.width = `${Math.round((done / total) * 100)}%`;
    startBtn.textContent     = `Uploading ${done} / ${total}…`;
  }

  startBtn.disabled    = false;
  startBtn.textContent = 'Done';
  const failed = (S.uploadQueue || []).filter(i => i.status === 'error').length;
  if (failed === 0) toast(`${done} file${done === 1 ? '' : 's'} uploaded`, 'success');
  else toast(`${done - failed} uploaded · ${failed} failed`, 'error');
  await loadDirectory(S.path);
}

// Copy Folder Modal
async function openCopyFolderModal(folderPath, fmt = null) {
  S.copyFolderPath   = folderPath;
  S.copyFolderFormat = fmt || S.copyFolderFormat || 'cdn';

  document.getElementById('copy-folder-name').textContent    = folderPath || 'root';
  document.getElementById('copy-folder-count').textContent   = '';
  document.getElementById('copy-folder-preview').textContent = 'Loading…';

  // Sync tab buttons
  document.querySelectorAll('#copy-folder-format-tabs .format-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === S.copyFolderFormat);
  });

  openModal('modal-copy-folder');
  await refreshCopyFolderPreview();
}

async function refreshCopyFolderPreview() {
  const preview = document.getElementById('copy-folder-preview');
  const cacheKey = `${S.copyFolderPath}::files`;

  let files;
  if (S.treeCache.has(cacheKey)) {
    files = S.treeCache.get(cacheKey);
  } else {
    preview.textContent = 'Loading…';
    try {
      let raw = await api.getContents(S.copyFolderPath || '');
      if (!Array.isArray(raw)) raw = [raw];
      files = raw.filter(i => i.type === 'file' && !isHidden(i));
      S.treeCache.set(cacheKey, files);
    } catch (err) {
      preview.textContent = `Error: ${err.message}`;
      return;
    }
  }

  if (files.length === 0) {
    preview.textContent = '(no files in this folder)';
    document.getElementById('copy-folder-count').textContent = '0 files';
    return;
  }

  document.getElementById('copy-folder-count').textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
  preview.textContent = formatPaths(files, S.copyFolderFormat);
}

function executeCopyFolder() {
  const text = document.getElementById('copy-folder-preview').textContent;
  if (!text || text === 'Loading…' || text.startsWith('Error') || text.startsWith('(no files')) {
    toast('Nothing to copy', 'info'); return;
  }
  const n = text.split('\n').filter(Boolean).length;
  copyText(text, `Copied ${n} path${n === 1 ? '' : 's'}`);
}

// ── Drag & Drop ───────────────────────────────────────────
function setupDragDrop() {
  const area = document.getElementById('file-area');
  let counter = 0;

  area.addEventListener('dragenter', e => {
    e.preventDefault(); counter++;
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => {
    counter--; if (counter <= 0) { counter = 0; area.classList.remove('drag-over'); }
  });
  area.addEventListener('dragover', e => e.preventDefault());
  area.addEventListener('drop', e => {
    e.preventDefault(); counter = 0; area.classList.remove('drag-over');
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) addFilesToUploadQueue(files);
  });

  // Drop zone in upload modal
  const dz = document.getElementById('modal-drop-zone');
  dz.addEventListener('click', () => document.getElementById('file-input').click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) addFilesToUploadQueue(files);
  });
}

function addFilesToUploadQueue(files) {
  if (!S.uploadQueue) S.uploadQueue = [];
  S.uploadQueue.push(...files.map(f => ({ file: f, status: 'pending' })));
  S.uploadQueuePersist = true;
  openUploadModal();
}

// ── View Mode ─────────────────────────────────────────────
function setViewMode(mode) {
  S.viewMode = mode;
  saveSettings();
  document.getElementById('btn-grid-view').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list-view').classList.toggle('active', mode === 'list');
  renderFiles();
}

// ── Init ──────────────────────────────────────────────────
function init() {
  loadSettings();
  S.uploadQueue = [];

  // ── Topbar ────────────────────────────────────────────
  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  // ── Toolbar ───────────────────────────────────────────
  document.getElementById('btn-upload').addEventListener('click', openUploadModal);
  document.getElementById('btn-new-folder').addEventListener('click', openNewFolderModal);
  document.getElementById('btn-select-all').addEventListener('click', selectAll);
  document.getElementById('btn-grid-view').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btn-list-view').addEventListener('click',  () => setViewMode('list'));

  document.getElementById('search-input').addEventListener('input', e => {
    S.filter = e.target.value;
    renderFiles();
  });

  // ── Selection Bar ─────────────────────────────────────
  document.getElementById('btn-deselect').addEventListener('click', clearSelection);

  const copyDropdown = document.getElementById('copy-selected-dropdown');
  document.getElementById('btn-copy-selected').addEventListener('click', e => {
    e.stopPropagation();
    copyDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => copyDropdown.classList.remove('open'));

  document.querySelectorAll('#copy-dropdown-menu [data-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      const selected = S.items.filter(i => S.selected.has(i.path) && i.type !== 'dir');
      if (!selected.length) { toast('No files selected', 'info'); return; }
      const text = formatPaths(selected, btn.dataset.format);
      copyText(text, `Copied ${selected.length} path${selected.length === 1 ? '' : 's'}`);
      copyDropdown.classList.remove('open');
    });
  });

  // ── Settings Modal ────────────────────────────────────
  document.getElementById('settings-save-btn').addEventListener('click', saveSettingsFromForm);
  document.getElementById('settings-cancel-btn').addEventListener('click', closeAllModals);
  document.getElementById('settings-close-btn').addEventListener('click', closeAllModals);
  document.getElementById('settings-form').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveSettingsFromForm();
  });

  // ── New Folder Modal ──────────────────────────────────
  document.getElementById('new-folder-submit-btn').addEventListener('click', createFolder);
  document.getElementById('new-folder-cancel-btn').addEventListener('click', closeAllModals);
  document.getElementById('new-folder-close-btn').addEventListener('click', closeAllModals);
  document.getElementById('new-folder-input').addEventListener('input', updateFolderPathPreview);
  document.getElementById('new-folder-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') createFolder();
  });

  // ── Delete Modal ──────────────────────────────────────
  document.getElementById('delete-confirm-btn').addEventListener('click', confirmDelete);
  document.getElementById('delete-cancel-btn').addEventListener('click', closeAllModals);
  document.getElementById('delete-close-btn').addEventListener('click', closeAllModals);

  // ── Upload Modal ──────────────────────────────────────
  document.getElementById('upload-start-btn').addEventListener('click', startUpload);
  document.getElementById('upload-cancel-btn').addEventListener('click', closeAllModals);
  document.getElementById('upload-close-btn').addEventListener('click', closeAllModals);
  document.getElementById('file-input').addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) addFilesToUploadQueue(files);
  });

  // ── Copy Folder Modal ─────────────────────────────────
  document.getElementById('copy-folder-copy-btn').addEventListener('click', executeCopyFolder);
  document.getElementById('copy-folder-close-btn').addEventListener('click', closeAllModals);
  document.getElementById('copy-folder-close-btn2').addEventListener('click', closeAllModals);

  document.querySelectorAll('#copy-folder-format-tabs .format-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      S.copyFolderFormat = btn.dataset.format;
      document.querySelectorAll('#copy-folder-format-tabs .format-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.format === S.copyFolderFormat);
      });
      // Bust cache so fresh content is shown with new format
      S.treeCache.delete(`${S.copyFolderPath}::files`);
      refreshCopyFolderPreview();
    });
  });

  // ── Modal backdrop click-outside ──────────────────────
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAllModals();
  });

  // ── Drag & Drop ───────────────────────────────────────
  setupDragDrop();

  // ── Sync initial view toggle state ───────────────────
  document.getElementById('btn-grid-view').classList.toggle('active', S.viewMode === 'grid');
  document.getElementById('btn-list-view').classList.toggle('active', S.viewMode === 'list');

  // ── Initial load ──────────────────────────────────────
  if (S.token) {
    initFolderTree();
    navigateTo('');
  } else {
    document.getElementById('folder-tree').innerHTML =
      `<div style="padding:12px 14px;font-size:.75rem;opacity:.45;line-height:1.5">
        Add your GitHub token<br>in Settings to begin.
       </div>`;
    setFileArea(tokenWarningHtml());
    renderBreadcrumb();
  }
}

document.addEventListener('DOMContentLoaded', init);
