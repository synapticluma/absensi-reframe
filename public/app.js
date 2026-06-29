'use strict';

function getToken() { return localStorage.getItem('authToken'); }

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

let currentUser = null;
let currentStream = null;
let facingMode = 'environment';
let capturedBlob = null;
let deleteTargetId = null;
let filterDebounce = null;

const $ = id => document.getElementById(id);

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  initDateTime();
  initTabs();
  initOutletSelector();
  initCamera();
  initForm();
  initRiwayat();
  loadStats();
});

/* ── Auth: load current user ── */
async function loadCurrentUser() {
  try {
    const res = await authFetch('/api/me');
    if (res.status === 401) { window.location.href = '/login'; return; }
    currentUser = await res.json();
    applyRoleUI();
  } catch {
    window.location.href = '/login';
  }
}

function applyRoleUI() {
  const u = currentUser;
  if (!u) return;

  // Header user avatar
  $('userAvatar').textContent = u.name.charAt(0).toUpperCase();
  $('userAvatar').title = `${u.name} (${u.role})`;

  if (u.role === 'admin') {
    // Show admin tab
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    // Hide name field for admin form (admin can still set name freely)
  } else {
    // Pegawai: pre-fill name and make read-only
    $('nameInput').value = u.name;
    $('nameInput').readOnly = true;
    $('nameInput').style.background = '#f1f5f9';
    $('nameInput').style.color = '#64748b';

    // Show user strip
    const strip = $('userStrip');
    strip.style.display = 'flex';
    $('stripAvatar').textContent = u.name.charAt(0).toUpperCase();
    $('stripName').textContent = u.name;
  }

  // Logout
  $('logoutBtn').addEventListener('click', logout);
}

async function logout() {
  localStorage.removeItem('authToken');
  await authFetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

/* ── Live DateTime ── */
function initDateTime() {
  const el = $('liveDateTime');
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }) + ' · ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };
  update();
  setInterval(update, 30000);

  const now = new Date();
  $('dateInput').value = now.toISOString().split('T')[0];
  $('timeInput').value = now.toTimeString().slice(0, 5);
}

/* ── Tabs ── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + tab).classList.add('active');
      if (tab === 'riwayat') loadRecords();
      if (tab === 'admin') loadUsers();
    });
  });
}

/* ── Outlet Selector ── */
function initOutletSelector() {
  document.querySelectorAll('.outlet-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.outlet-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      $('outletInput').value = card.dataset.outlet;
    });
  });
}

/* ── Camera ── */
function initCamera() {
  $('openCameraBtn').addEventListener('click', startCamera);
  $('openGalleryBtn').addEventListener('click', () => $('galleryInput').click());
  $('galleryInput').addEventListener('change', handleGallerySelect);
  $('snapBtn').addEventListener('click', capturePhoto);
  $('flipCameraBtn').addEventListener('click', flipCamera);
  $('cancelCameraBtn').addEventListener('click', stopCamera);
  $('retakeBtn').addEventListener('click', resetCamera);
}

async function startCamera() {
  try {
    if (currentStream) stopStream();
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    $('videoEl').srcObject = currentStream;
    showCameraState('live');
  } catch (err) {
    if (err.name === 'NotAllowedError') alert('Akses kamera ditolak. Izinkan akses kamera di pengaturan browser.');
    else if (err.name === 'NotFoundError') alert('Kamera tidak ditemukan. Gunakan upload galeri.');
    else alert('Kamera tidak dapat diakses: ' + err.message);
  }
}

async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

function stopCamera() { stopStream(); showCameraState('idle'); }

function stopStream() {
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
}

function capturePhoto() {
  const video = $('videoEl');
  const canvas = $('photoCanvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    capturedBlob = blob;
    $('photoPreviewImg').src = URL.createObjectURL(blob);
    stopStream();
    showCameraState('preview');
    clearFieldError('photo');
  }, 'image/jpeg', 0.85);
}

function resetCamera() {
  capturedBlob = null;
  $('photoPreviewImg').src = '';
  showCameraState('idle');
}

function showCameraState(state) {
  $('cameraIdle').style.display = state === 'idle' ? 'flex' : 'none';
  $('cameraLive').style.display = state === 'live' ? 'block' : 'none';
  $('cameraPreview').style.display = state === 'preview' ? 'block' : 'none';
}

function handleGallerySelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Pilih file gambar'); return; }
  capturedBlob = file;
  $('photoPreviewImg').src = URL.createObjectURL(file);
  showCameraState('preview');
  clearFieldError('photo');
  e.target.value = '';
}

/* ── Form Submit ── */
function initForm() {
  $('attendanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const btn = $('submitBtn');
    btn.disabled = true;
    btn.querySelector('.submit-text').style.display = 'none';
    btn.querySelector('.submit-loading').style.display = 'flex';

    try {
      const fd = new FormData();
      fd.append('name', $('nameInput').value.trim());
      fd.append('outlet', $('outletInput').value);
      fd.append('date', $('dateInput').value);
      fd.append('time', $('timeInput').value);
      if (capturedBlob) fd.append('photo', capturedBlob, 'absensi.jpg');

      const res = await authFetch('/api/attendance', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');

      showSuccessModal($('nameInput').value.trim(), $('outletInput').value, $('dateInput').value, $('timeInput').value);
      resetForm();
      loadStats();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.querySelector('.submit-text').style.display = 'flex';
      btn.querySelector('.submit-loading').style.display = 'none';
    }
  });
}

function validateForm() {
  let valid = true;
  const name = $('nameInput').value.trim();
  if (!name) { showFieldError('name'); valid = false; } else clearFieldError('name');
  if (!capturedBlob) { showFieldError('photo'); valid = false; } else clearFieldError('photo');
  return valid;
}

function showFieldError(field) {
  const el = field === 'name' ? $('nameInput') : $('cameraBox');
  el.parentElement.classList.add('error');
}
function clearFieldError(field) {
  const el = field === 'name' ? $('nameInput') : $('cameraBox');
  el.parentElement.classList.remove('error');
}

function resetForm() {
  if (currentUser.role === 'admin') $('attendanceForm').reset();
  const now = new Date();
  $('dateInput').value = now.toISOString().split('T')[0];
  $('timeInput').value = now.toTimeString().slice(0, 5);
  if (currentUser.role === 'pegawai') $('nameInput').value = currentUser.name;
  capturedBlob = null;
  resetCamera();
  document.querySelectorAll('.outlet-card').forEach(c => c.classList.remove('active'));
  document.querySelector('.outlet-card[data-outlet="Mara"]').classList.add('active');
  $('outletInput').value = 'Mara';
}

/* ── Success Modal ── */
function showSuccessModal(name, outlet, date, time) {
  const dateStr = new Date(date + 'T00:00').toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('successDetail').textContent = `${name} · ${outlet}\n${dateStr}${time ? ' · ' + time : ''}`;
  $('successOverlay').style.display = 'flex';
  $('successOkBtn').onclick = () => { $('successOverlay').style.display = 'none'; };
}

/* ── Stats ── */
async function loadStats() {
  try {
    const data = await authFetch('/api/stats').then(r => r.json());
    $('statToday').textContent = data.today_total;
    $('statMara').textContent = data.today_mara;
    $('statLantedua').textContent = data.today_lantedua;
  } catch {}
}

/* ── Riwayat ── */
function initRiwayat() {
  $('filterDate').addEventListener('input', debouncedLoad);
  $('filterOutlet').addEventListener('change', loadRecords);
  const search = $('filterSearch');
  if (search) search.addEventListener('input', debouncedLoad);
  const exportBtn = $('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);
  $('deleteCancelBtn').addEventListener('click', () => { $('deleteOverlay').style.display = 'none'; deleteTargetId = null; });
  $('deleteConfirmBtn').addEventListener('click', confirmDelete);
}

function debouncedLoad() {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(loadRecords, 400);
}

async function loadRecords() {
  const date = $('filterDate').value;
  const outlet = $('filterOutlet').value;
  const search = $('filterSearch') ? $('filterSearch').value.trim() : '';
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (outlet !== 'all') params.set('outlet', outlet);
  if (search) params.set('search', search);

  $('recordsList').innerHTML = '<div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
  try {
    const records = await authFetch('/api/attendance?' + params).then(r => r.json());
    renderRecords(records);
  } catch {
    $('recordsList').innerHTML = '<div class="empty-state"><p>Gagal memuat data</p></div>';
  }
}

function renderRecords(records) {
  $('recordCount').textContent = records.length > 0 ? `Menampilkan ${records.length} data` : 'Tidak ada data';
  if (records.length === 0) {
    $('recordsList').innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p>Belum ada data absensi</p>
      </div>`;
    return;
  }

  const isAdmin = currentUser.role === 'admin';
  $('recordsList').innerHTML = records.map(r => {
    const dateStr = new Date(r.date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const cls = r.outlet === 'Mara' ? 'badge-mara' : 'badge-lantedua';
    const photoUrl = r.photo_path ? `/api/photo/${r.photo_path}?token=${encodeURIComponent(getToken() || '')}` : null;
    const photoHtml = photoUrl
      ? `<img src="${photoUrl}" alt="Foto" loading="lazy" onclick="openPhoto('${photoUrl}')">`
      : `<div class="record-photo-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg></div>`;

    const deleteBtn = isAdmin ? `
      <button class="btn-delete" onclick="requestDelete(${r.id},'${escapeHtml(r.name)}')" title="Hapus">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>` : '';

    return `
      <div class="record-card">
        <div class="record-photo-wrap" ${photoUrl ? `onclick="openPhoto('${photoUrl}')"` : ''}>${photoHtml}</div>
        <div class="record-info">
          <div class="record-name">${escapeHtml(r.name)}</div>
          <div class="record-meta">
            <span class="badge ${cls}">${r.outlet}</span>
            <span class="badge badge-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${dateStr}
            </span>
          </div>
          ${r.time ? `<div class="record-time">${r.time}</div>` : ''}
        </div>
        ${deleteBtn ? `<div class="record-actions">${deleteBtn}</div>` : ''}
      </div>`;
  }).join('');
}

/* ── Delete ── */
function requestDelete(id, name) {
  deleteTargetId = id;
  $('deleteDetail').textContent = `Absensi "${name}" akan dihapus permanen.`;
  $('deleteOverlay').style.display = 'flex';
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  try {
    const res = await authFetch(`/api/attendance/${deleteTargetId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus');
    $('deleteOverlay').style.display = 'none';
    deleteTargetId = null;
    await loadRecords();
    await loadStats();
  } catch (err) { alert('Error: ' + err.message); }
}

/* ── Admin: Users list ── */
async function loadUsers() {
  const list = $('usersList');
  list.innerHTML = '<div class="skeleton-list"><div class="skeleton-card" style="height:110px"></div><div class="skeleton-card" style="height:110px"></div><div class="skeleton-card" style="height:110px"></div></div>';
  try {
    const users = await authFetch('/api/users').then(r => r.json());
    renderUsers(users);
  } catch {
    list.innerHTML = '<div class="empty-state"><p>Gagal memuat data pengguna</p></div>';
  }
}

function renderUsers(users) {
  $('usersList').innerHTML = users.map(u => {
    const isAdmin = u.role === 'admin';
    const lastDate = u.last_attendance
      ? new Date(u.last_attendance.date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + (u.last_attendance.time ? ' · ' + u.last_attendance.time : '')
      : 'Belum pernah';
    const isSelf = u.id === currentUser.id;

    return `
      <div class="user-card ${isSelf ? 'self' : ''}">
        <div class="user-card-left">
          <div class="user-card-avatar ${isAdmin ? 'admin-av' : 'pegawai-av'}">${u.name.charAt(0)}</div>
        </div>
        <div class="user-card-info">
          <div class="user-card-name">${escapeHtml(u.name)} ${isSelf ? '<span class="self-badge">Anda</span>' : ''}</div>
          <div class="user-card-username">@${escapeHtml(u.username)}</div>
          <div class="user-card-meta">
            <span class="badge ${isAdmin ? 'badge-admin' : 'badge-pegawai-role'}">${isAdmin ? 'Admin' : 'Pegawai'}</span>
            <span class="user-stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              ${u.total_attendance} absensi
            </span>
            ${u.today_attendance > 0 ? `<span class="badge-today">${u.today_attendance} hari ini</span>` : ''}
          </div>
          <div class="user-card-last">Terakhir: ${lastDate}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── Photo Modal ── */
function openPhoto(url) { $('fullscreenPhoto').src = url; $('photoOverlay').style.display = 'flex'; }
function closePhotoModal() { $('photoOverlay').style.display = 'none'; }

/* ── Export CSV ── */
function exportCSV() {
  const params = new URLSearchParams();
  const date = $('filterDate').value;
  const outlet = $('filterOutlet').value;
  if (date) params.set('date', date);
  if (outlet !== 'all') params.set('outlet', outlet);
  const token = getToken();
  if (token) params.set('token', token);
  window.location.href = '/api/export?' + params;
}

/* ── Helpers ── */
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

window.openPhoto = openPhoto;
window.closePhotoModal = closePhotoModal;
window.requestDelete = requestDelete;
