// Online admin panel: Google sign-in + Firestore.
// Who may write is enforced by the database security rules (the "admins" list), not by this page.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, Bytes,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const PLATFORMS = ['PC', 'Mobile', 'Web'];
const DEFAULT_ACCENT = '#ffb627';
const DEFAULT_BG = '#0a0c13';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function explain(err) {
  if (err && err.code === 'permission-denied') return 'You do not have permission to change this.';
  return (err && err.message) || 'Something went wrong.';
}

const isHttp = (s) => /^https?:\/\//i.test(s || '');
const isYouTube = (s) => /youtu\.be\/|youtube(-nocookie)?\.com\//i.test(s || '');

// Images are shrunk in the browser and stored inside the database entry itself.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

async function shrinkImage(source, max, square) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const iw = img.naturalWidth || max;
    const ih = img.naturalHeight || max;
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    if (square) {
      // Centre-crop to a square icon.
      const side = Math.min(iw, ih);
      c.width = c.height = Math.min(max, side);
      x.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, c.width, c.height);
    } else {
      const scale = Math.min(1, max / Math.max(iw, ih));
      c.width = Math.max(1, Math.round(iw * scale));
      c.height = Math.max(1, Math.round(ih * scale));
      x.drawImage(img, 0, 0, c.width, c.height);
    }
    let out = c.toDataURL('image/webp', 0.86);
    if (out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/png');
    return out;
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

// ---------- Start-up ----------
const cfg = window.FIREBASE_CONFIG;
if (!cfg) {
  $('gateMsg').textContent = 'The online admin panel is not set up yet.';
  throw new Error('No Firebase config');
}

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;
let games = [];
let site = {};

function showGate(msg, signedIn) {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateMsg').textContent = msg || '';
  $('signIn').disabled = false;
  $('signIn').hidden = !!signedIn;
  $('gateSignOut').hidden = !signedIn;
}

$('signIn').onclick = async () => {
  $('gateMsg').textContent = '';
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    $('gateMsg').textContent = err.code === 'auth/popup-blocked'
      ? 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.'
      : 'Sign-in failed: ' + (err.code || err.message);
  }
};
$('gateSignOut').onclick = () => signOut(auth);
$('signOut').onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  me = user;
  if (!user) return showGate('', false);
  const email = (user.email || '').toLowerCase();
  $('gateMsg').textContent = 'Checking access…';
  try {
    const snap = await getDoc(doc(db, 'admins', email));
    if (!snap.exists()) throw Object.assign(new Error('not admin'), { code: 'permission-denied' });
  } catch (err) {
    return showGate(err.code === 'permission-denied'
      ? email + ' is not on the admin list. Ask an existing admin to add this address.'
      : 'Could not check access: ' + explain(err), true);
  }
  $('who').textContent = email;
  $('gate').hidden = true;
  $('app').hidden = false;
  try {
    await loadAll();
  } catch (err) {
    toast('Could not load: ' + explain(err), true);
  }
});

async function loadAll() {
  const [gameDocs, siteDoc] = await Promise.all([
    getDocs(collection(db, 'games')),
    getDoc(doc(db, 'config', 'site')),
  ]);
  games = gameDocs.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  games.sort((a, b) => (a.order || 0) - (b.order || 0));
  site = siteDoc.exists() ? siteDoc.data() : {};
  const oldGames = Array.isArray(window.GAMES) ? window.GAMES : [];
  render();
  // First time an admin opens the panel: bring the games saved with the site into the database
  // automatically. The import also writes config/site, so this only ever happens once.
  if (games.length === 0 && !siteDoc.exists() && oldGames.length > 0) {
    $('importBox').hidden = false;
    await importOld();
  } else {
    $('importBox').hidden = true;
  }
}

// ---------- Game list ----------
function render() {
  const list = $('list');
  list.textContent = '';
  $('count').textContent = games.length;
  if (!games.length) {
    list.appendChild(el('div', 'empty', 'No games yet. Click “+ Add game” to add the first one.'));
    return;
  }
  games.forEach((g, i) => {
    const row = el('div', 'row');
    const thumb = el('div', 'thumb');
    if (g.icon) {
      const img = el('img'); img.src = g.icon; img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.textContent = (g.name || '?').trim().charAt(0).toUpperCase();
    }
    row.appendChild(thumb);

    const info = el('div', 'info');
    const name = el('div', 'name', g.name || 'Untitled');
    const tags = el('span', 'tags');
    const plats = PLATFORMS.filter((p) => (g.platforms || []).includes(p));
    if (plats.length) plats.forEach((p) => tags.appendChild(el('span', 'tag ' + p.toLowerCase(), p)));
    else tags.appendChild(el('span', 'tag none', 'No platform'));
    name.appendChild(tags);
    info.appendChild(name);
    const links = g.links || {};
    const linked = plats.filter((p) => links[p]);
    info.appendChild(el('div', 'meta', (g.genre ? g.genre + '  ·  ' : '') +
      (linked.length ? 'Links: ' + linked.join(', ') : 'No playable link') + '  ·  ' + (g.trailer ? 'Trailer ✓' : 'No trailer')));
    row.appendChild(info);

    const acts = el('div', 'row-actions');
    const mk = (label, cls, title) => {
      const b = el('button', 'small' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      if (title) b.title = title;
      acts.appendChild(b);
      return b;
    };
    const up = mk('↑', '', 'Move up'); up.disabled = i === 0;
    const down = mk('↓', '', 'Move down'); down.disabled = i === games.length - 1;
    const edit = mk('Edit');
    const del = mk('Delete', 'danger');
    up.onclick = () => move(i, -1);
    down.onclick = () => move(i, 1);
    edit.onclick = () => openForm(g);
    del.onclick = () => remove(g);
    row.appendChild(acts);
    list.appendChild(row);
  });
}

async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= games.length) return;
  const next = games.slice();
  [next[i], next[j]] = [next[j], next[i]];
  try {
    // Renumber so the order is always clean, and write only what changed.
    const batch = writeBatch(db);
    next.forEach((g, n) => {
      if (g.order !== n) { batch.set(doc(db, 'games', g.id), { order: n }, { merge: true }); g.order = n; }
    });
    await batch.commit();
    games = next;
    render();
    toast('Order saved');
  } catch (err) {
    toast('Not saved: ' + explain(err), true);
  }
}

async function remove(g) {
  if (!confirm('Delete “' + (g.name || 'Untitled') + '” from the showcase?')) return;
  try {
    await deleteDoc(doc(db, 'games', g.id));
    const vid = /^db:(.+)$/.exec(g.trailer || '');
    if (vid) deleteVideo(vid[1]);
    games = games.filter((x) => x.id !== g.id);
    render();
    toast('Game deleted');
  } catch (err) {
    toast('Not deleted: ' + explain(err), true);
  }
}

// ---------- Game form ----------
let editingId = null;
let icon = { data: '', file: null };
// Uploaded trailer: id = one already stored in the database, file = a newly chosen one waiting to upload.
let video = { id: '', file: null };

const MAX_VIDEO_MB = 20;
const CHUNK_BYTES = 950000; // a database entry holds at most 1 MB

function refreshVideo() {
  const has = !!(video.file || video.id);
  $('videoClear').hidden = !has;
  $('videoName').textContent = video.file
    ? video.file.name + ' (' + (video.file.size / 1048576).toFixed(1) + ' MB) — uploads when you press Save'
    : (video.id ? 'Uploaded video in use' : '');
}

// Stores the video as numbered pieces under videos/<id>/chunks, then a small summary entry.
async function uploadVideo(file, onProgress) {
  const id = doc(collection(db, 'videos')).id;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const count = Math.ceil(bytes.length / CHUNK_BYTES);
  try {
    for (let i = 0; i < count; i++) {
      const part = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      await setDoc(doc(db, 'videos', id, 'chunks', String(i).padStart(4, '0')), { data: Bytes.fromUint8Array(part) });
      onProgress((i + 1) / count);
    }
    await setDoc(doc(db, 'videos', id), {
      name: file.name, type: file.type || 'video/mp4', size: bytes.length, chunks: count, at: Date.now(),
    });
  } catch (err) {
    // Don't leave half an upload behind.
    for (let i = 0; i < count; i++) {
      deleteDoc(doc(db, 'videos', id, 'chunks', String(i).padStart(4, '0'))).catch(() => {});
    }
    throw err;
  }
  return id;
}

async function deleteVideo(id) {
  try {
    const meta = await getDoc(doc(db, 'videos', id));
    const count = meta.exists() ? (meta.data().chunks || 0) : 0;
    for (let i = 0; i < count; i++) {
      await deleteDoc(doc(db, 'videos', id, 'chunks', String(i).padStart(4, '0')));
    }
    await deleteDoc(doc(db, 'videos', id));
  } catch (err) {
    console.warn('Could not remove old video', id, err);
  }
}

function refreshIcon() {
  const ip = $('iconPreview');
  ip.textContent = '';
  if (icon.data) { const img = el('img'); img.src = icon.data; img.alt = ''; ip.appendChild(img); }
  else ip.textContent = 'No icon';
}

function openForm(g) {
  editingId = g ? g.id : null;
  $('formTitle').textContent = g ? 'Edit game' : 'Add game';
  $('fName').value = g ? (g.name || '') : '';
  $('fGenre').value = g ? (g.genre || '') : '';
  const links = g ? (g.links || {}) : {};
  document.querySelectorAll('.plat').forEach((row) => {
    const c = row.querySelector('input[type=checkbox]');
    c.checked = !!g && (g.platforms || []).includes(c.value);
    row.querySelector('input[data-link]').value = c.checked ? (links[c.value] || '') : '';
  });
  icon = { data: g ? (g.icon || '') : '', file: null };
  const savedTrailer = g ? (g.trailer || '') : '';
  const savedVideo = /^db:(.+)$/.exec(savedTrailer);
  video = { id: savedVideo ? savedVideo[1] : '', file: null };
  $('fTrailer').value = savedVideo ? '' : savedTrailer;
  $('videoFile').value = '';
  refreshVideo();
  $('iconFile').value = '';
  $('formErr').hidden = true;
  $('progress').textContent = '';
  $('saveBtn').disabled = false;
  refreshIcon();
  $('dlg').showModal();
  $('fName').focus();
}

function fail(msg) { const e = $('formErr'); e.textContent = msg; e.hidden = false; }

$('addBtn').onclick = () => openForm(null);
$('cancelBtn').onclick = () => $('dlg').close();
$('iconPick').onclick = () => $('iconFile').click();
$('iconClear').onclick = () => { icon = { data: '', file: null }; $('iconFile').value = ''; refreshIcon(); };
$('iconFile').onchange = async function () {
  if (!this.files[0]) return;
  try {
    icon.data = await shrinkImage(this.files[0], 256, true);
    $('formErr').hidden = true;
    refreshIcon();
  } catch (err) { fail(err.message); }
};
$('videoPick').onclick = () => $('videoFile').click();
$('videoFile').onchange = function () {
  const f = this.files[0];
  if (!f) return;
  if (!/\.(mp4|webm)$/i.test(f.name)) { this.value = ''; return fail('Please choose an MP4 or WebM video.'); }
  if (f.size > MAX_VIDEO_MB * 1048576) {
    this.value = '';
    return fail('That video is ' + Math.round(f.size / 1048576) + ' MB. Uploads must be under ' + MAX_VIDEO_MB +
      ' MB — export a shorter or 720p clip, or put it on YouTube or Google Drive and paste the link.');
  }
  $('formErr').hidden = true;
  video.file = f;
  $('fTrailer').value = '';
  refreshVideo();
};
$('videoClear').onclick = () => { video = { id: '', file: null }; $('videoFile').value = ''; refreshVideo(); };
// A pasted link replaces an uploaded video.
$('fTrailer').addEventListener('input', () => {
  if ($('fTrailer').value.trim() && (video.file || video.id)) {
    video = { id: '', file: null }; $('videoFile').value = ''; refreshVideo();
  }
});
document.querySelectorAll('.plat input[data-link]').forEach((inp) => {
  inp.addEventListener('input', () => {
    if (inp.value.trim()) inp.closest('.plat').querySelector('input[type=checkbox]').checked = true;
  });
});

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('formErr').hidden = true;
  const name = $('fName').value.trim();
  const trailerUrl = $('fTrailer').value.trim();
  if (!name) return fail('Please enter the game name.');
  if (trailerUrl && !isHttp(trailerUrl)) return fail('The trailer link must start with http:// or https://');
  const platforms = [];
  const links = {};
  let badLink = '';
  document.querySelectorAll('.plat').forEach((row) => {
    const c = row.querySelector('input[type=checkbox]');
    const url = row.querySelector('input[data-link]').value.trim();
    if (!c.checked) return;
    platforms.push(c.value);
    if (!url) return;
    if (!isHttp(url)) badLink = c.value;
    links[c.value] = url;
  });
  if (badLink) return fail('The ' + badLink + ' link must start with http:// or https://');

  $('saveBtn').disabled = true;
  $('progress').textContent = 'Saving…';
  try {
    const existing = editingId ? games.find((g) => g.id === editingId) : null;
    const ref = existing ? doc(db, 'games', existing.id) : doc(collection(db, 'games'));
    const order = existing ? (existing.order || 0) : games.reduce((m, g) => Math.max(m, (g.order || 0) + 1), 0);
    let trailer = trailerUrl;
    if (video.file) {
      $('progress').textContent = 'Uploading video…';
      const id = await uploadVideo(video.file, (f) => { $('progress').textContent = 'Uploading video ' + Math.round(f * 100) + '%'; });
      trailer = 'db:' + id;
      $('progress').textContent = 'Saving…';
    } else if (!trailerUrl && video.id) {
      trailer = 'db:' + video.id;
    }
    const data = { name, genre: $('fGenre').value.trim(), icon: icon.data, platforms, links, trailer, order };
    await setDoc(ref, data);
    // Remove the previous uploaded video if this game no longer uses it.
    const before = existing ? /^db:(.+)$/.exec(existing.trailer || '') : null;
    if (before && 'db:' + before[1] !== trailer) deleteVideo(before[1]);
    const saved = Object.assign({ id: ref.id }, data);
    games = existing ? games.map((g) => (g.id === existing.id ? saved : g)) : games.concat([saved]);
    render();
    $('dlg').close();
    toast(existing ? 'Game updated' : 'Game added');
  } catch (err) {
    fail(explain(err));
    $('progress').textContent = '';
    $('saveBtn').disabled = false;
  }
});

// ---------- Logo & colours ----------
let logoData = '';

function refreshSite() {
  const lp = $('logoPreview');
  lp.textContent = '';
  if (logoData) { const img = el('img'); img.src = logoData; img.alt = ''; lp.appendChild(img); }
  else lp.textContent = 'No logo';
  $('fromLogo').disabled = !logoData;
  const accent = $('sAccent').value;
  const bg = $('sBg').value;
  const tp = $('themePreview');
  tp.style.background = bg;
  tp.style.color = lum(hexToRgb(bg)) > 0.55 ? '#14161d' : '#f4f1e8';
  const chip = tp.querySelector('.tp-chip');
  chip.style.background = 'linear-gradient(135deg, ' + accent + ', ' + $('sAccent2').value + ')';
  chip.style.color = lum(hexToRgb(accent)) > 0.55 ? '#14161d' : '#ffffff';
}

const hexOk = (s) => /^#[0-9a-f]{6}$/i.test(s || '');

$('siteBtn').onclick = () => {
  logoData = site.logo || '';
  $('logoFile').value = '';
  $('sShowTitle').checked = site.showTitle !== false;
  $('sAccent').value = hexOk(site.accent) ? site.accent : DEFAULT_ACCENT;
  $('sAccent2').value = hexOk(site.accent2) ? site.accent2 : $('sAccent').value;
  $('sBg').value = hexOk(site.bg) ? site.bg : DEFAULT_BG;
  $('siteErr').hidden = true;
  $('siteProgress').textContent = '';
  $('siteSave').disabled = false;
  refreshSite();
  $('siteDlg').showModal();
};
$('siteCancel').onclick = () => $('siteDlg').close();
$('logoPick').onclick = () => $('logoFile').click();
$('logoClear').onclick = () => { logoData = ''; $('logoFile').value = ''; refreshSite(); };
$('logoFile').onchange = async function () {
  if (!this.files[0]) return;
  try { logoData = await shrinkImage(this.files[0], 320, false); refreshSite(); }
  catch (err) { $('siteErr').textContent = err.message; $('siteErr').hidden = false; }
};
$('sAccent').oninput = refreshSite;
$('sAccent2').oninput = refreshSite;
$('sBg').oninput = refreshSite;
$('resetColors').onclick = () => {
  $('sAccent').value = DEFAULT_ACCENT; $('sAccent2').value = DEFAULT_ACCENT; $('sBg').value = DEFAULT_BG; refreshSite();
};
$('fromLogo').onclick = () => {
  if (!logoData) return;
  $('siteErr').hidden = true;
  coloursFromLogo(logoData).then((c) => {
    $('sAccent').value = c.accent; $('sAccent2').value = c.accent; $('sBg').value = c.bg; refreshSite();
  }).catch((e) => { $('siteErr').textContent = e.message; $('siteErr').hidden = false; });
};

$('siteForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('siteErr').hidden = true;
  $('siteSave').disabled = true;
  $('siteProgress').textContent = 'Saving…';
  const next = { logo: logoData, showTitle: $('sShowTitle').checked, accent: $('sAccent').value, bg: $('sBg').value };
  if ($('sAccent2').value.toLowerCase() !== next.accent.toLowerCase()) next.accent2 = $('sAccent2').value;
  try {
    await setDoc(doc(db, 'config', 'site'), next);
    site = next;
    $('siteDlg').close();
    toast('Logo & colours saved');
  } catch (err) {
    $('siteErr').textContent = explain(err); $('siteErr').hidden = false;
    $('siteProgress').textContent = '';
    $('siteSave').disabled = false;
  }
});

// ---------- Admins ----------
async function renderAdmins() {
  const list = $('adminList');
  list.textContent = 'Loading…';
  const snap = await getDocs(collection(db, 'admins'));
  const mine = (me.email || '').toLowerCase();
  list.textContent = '';
  snap.docs.map((d) => d.id).sort().forEach((email) => {
    const row = el('div', 'admin-row');
    row.appendChild(el('span', '', email + (email === mine ? '  (you)' : '')));
    if (email !== mine) {
      const b = el('button', 'small danger', 'Remove');
      b.type = 'button';
      b.onclick = async () => {
        if (!confirm('Remove ' + email + ' from the admins?')) return;
        try { await deleteDoc(doc(db, 'admins', email)); renderAdmins(); }
        catch (err) { $('adminsErr').textContent = explain(err); $('adminsErr').hidden = false; }
      };
      row.appendChild(b);
    }
    list.appendChild(row);
  });
}

$('adminsBtn').onclick = () => {
  $('adminsErr').hidden = true;
  $('newAdmin').value = '';
  $('adminsDlg').showModal();
  renderAdmins().catch((err) => { $('adminList').textContent = ''; $('adminsErr').textContent = explain(err); $('adminsErr').hidden = false; });
};
$('adminsClose').onclick = () => $('adminsDlg').close();
$('adminsForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('adminsErr').hidden = true;
  const email = $('newAdmin').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('adminsErr').textContent = 'Enter a full email address, for example name@gmail.com'; $('adminsErr').hidden = false;
    return;
  }
  try {
    await setDoc(doc(db, 'admins', email), { addedBy: (me.email || '').toLowerCase(), addedAt: Date.now() });
    $('newAdmin').value = '';
    renderAdmins();
  } catch (err) {
    $('adminsErr').textContent = explain(err); $('adminsErr').hidden = false;
  }
});

// ---------- One-time import of the games saved with the site ----------
$('importBtn').onclick = () => importOld();

async function importOld() {
  const old = Array.isArray(window.GAMES) ? window.GAMES : [];
  const oldSite = window.SITE && typeof window.SITE === 'object' ? window.SITE : {};
  $('importBtn').disabled = true;
  $('importBtn').textContent = 'Importing…';
  try {
    const batch = writeBatch(db);
    const added = [];
    let skippedTrailers = 0;
    for (let i = 0; i < old.length; i++) {
      const g = old[i];
      let iconData = '';
      if (g.icon) {
        try { iconData = await shrinkImage(isHttp(g.icon) ? g.icon : '../' + g.icon, 256, true); } catch (e) { iconData = ''; }
      }
      const platforms = (g.platforms || []).filter((p) => PLATFORMS.includes(p));
      const links = {};
      platforms.forEach((p) => {
        const url = g.links ? g.links[p] : g.link;
        if (isHttp(url)) links[p] = url;
      });
      // Only link trailers can move online; uploaded video files stay behind.
      let trailer = '';
      if (isHttp(g.trailer)) trailer = g.trailer;
      else if (g.trailer) skippedTrailers++;
      const ref = doc(collection(db, 'games'));
      const data = { name: g.name || 'Untitled', genre: g.genre || '', icon: iconData, platforms, links, trailer, order: i };
      batch.set(ref, data);
      added.push(Object.assign({ id: ref.id }, data));
    }
    const nextSite = { showTitle: oldSite.showTitle !== false };
    if (hexOk(oldSite.accent)) nextSite.accent = oldSite.accent;
    if (hexOk(oldSite.accent2)) nextSite.accent2 = oldSite.accent2;
    if (hexOk(oldSite.bg)) nextSite.bg = oldSite.bg;
    nextSite.logo = '';
    if (oldSite.logo) {
      try { nextSite.logo = await shrinkImage(isHttp(oldSite.logo) ? oldSite.logo : '../' + oldSite.logo, 320, false); } catch (e) { nextSite.logo = ''; }
    }
    batch.set(doc(db, 'config', 'site'), nextSite);
    await batch.commit();
    games = added;
    site = nextSite;
    $('importBox').hidden = true;
    render();
    toast('Imported ' + added.length + ' game(s)' + (skippedTrailers ? ' — ' + skippedTrailers + ' uploaded trailer(s) not moved' : ''));
  } catch (err) {
    $('importBtn').disabled = false;
    $('importBtn').textContent = 'Import the games currently on the site';
    toast('Import failed: ' + explain(err), true);
  }
};
