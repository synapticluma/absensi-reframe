const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'absensi-demo-secret-2024';

// In-memory stores
const users = [];
const attendance = [];
let nextAttendanceId = 1;
let nextUserId = 1;
const photos = new Map(); // photoId -> { buffer, mimetype }

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(plain, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(
    Buffer.from(crypto.scryptSync(plain, salt, 64).toString('hex')),
    Buffer.from(hash)
  );
}

// Seed users
for (const u of [
  { username: 'admin', password: 'admin123', name: 'Administrator', role: 'admin' },
  { username: 'budi',  password: 'budi123',  name: 'Budi Santoso',  role: 'pegawai' },
  { username: 'sari',  password: 'sari123',  name: 'Sari Dewi',     role: 'pegawai' },
]) {
  users.push({ id: nextUserId++, username: u.username, password_hash: hashPassword(u.password), name: u.name, role: u.role, created_at: new Date().toISOString() });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Hanya file gambar'))
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = (auth && auth.startsWith('Bearer ')) ? auth.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesi berakhir, silakan login kembali' });
  }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

/* ── Auth ── */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

  const user = users.find(u => u.username === username.trim());
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });

  try {
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Username atau password salah' });
  } catch {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  const payload = { id: user.id, username: user.username, name: user.name, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, user: payload });
});

app.post('/api/logout', (req, res) => res.json({ success: true }));
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

/* ── Photos ── */
app.get('/api/photo/:id', (req, res) => {
  const photo = photos.get(req.params.id);
  if (!photo) return res.status(404).send('Not found');
  res.set('Content-Type', photo.mimetype);
  res.send(photo.buffer);
});

/* ── Attendance: save ── */
app.post('/api/attendance', requireAuth, upload.single('photo'), (req, res) => {
  try {
    const { user } = req;
    const { name, outlet, date, time } = req.body;

    const finalName = user.role === 'pegawai' ? user.name : (name || '').trim();
    if (!finalName || !outlet || !date) return res.status(400).json({ error: 'Nama, outlet, dan tanggal wajib diisi' });
    if (!['Mara', 'Lantedua'].includes(outlet)) return res.status(400).json({ error: 'Outlet tidak valid' });

    let photoId = null;
    if (req.file) {
      photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      photos.set(photoId, { buffer: req.file.buffer, mimetype: req.file.mimetype });
    }

    const id = nextAttendanceId++;
    attendance.push({ id, user_id: user.id, name: finalName, outlet, date, time: time || '', photo_path: photoId, created_at: new Date().toISOString() });
    res.json({ success: true, id, message: 'Absensi berhasil disimpan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan absensi' });
  }
});

/* ── Attendance: get ── */
app.get('/api/attendance', requireAuth, (req, res) => {
  try {
    const { user } = req;
    const { outlet, date, search } = req.query;

    let records = [...attendance];
    if (user.role === 'pegawai') records = records.filter(r => r.user_id === user.id);
    if (outlet && outlet !== 'all') records = records.filter(r => r.outlet === outlet);
    if (date) records = records.filter(r => r.date === date);
    if (search && user.role === 'admin') records = records.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

    records.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.id - a.id);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

/* ── Attendance: delete ── */
app.delete('/api/attendance/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const id = parseInt(req.params.id);
    const idx = attendance.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const record = attendance[idx];
    if (record.photo_path) photos.delete(record.photo_path);
    attendance.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus data' });
  }
});

/* ── Export CSV ── */
app.get('/api/export', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const { outlet, date } = req.query;

    let records = [...attendance];
    if (outlet && outlet !== 'all') records = records.filter(r => r.outlet === outlet);
    if (date) records = records.filter(r => r.date === date);
    records.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

    const rows = [
      ['No', 'Nama', 'Outlet', 'Tanggal', 'Waktu', 'Foto'],
      ...records.map((r, i) => [i + 1, `"${r.name}"`, r.outlet, r.date, r.time, r.photo_path ? 'Ada' : '-'])
    ].map(r => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${Date.now()}.csv"`);
    res.send('﻿' + rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal export' });
  }
});

/* ── Stats ── */
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const { user } = req;
    const today = new Date().toISOString().split('T')[0];
    let records = user.role === 'pegawai' ? attendance.filter(r => r.user_id === user.id) : attendance;

    res.json({
      today_total:    records.filter(r => r.date === today).length,
      today_mara:     records.filter(r => r.date === today && r.outlet === 'Mara').length,
      today_lantedua: records.filter(r => r.date === today && r.outlet === 'Lantedua').length,
      total_all:      records.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

/* ── Users (admin only) ── */
app.get('/api/users', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const today = new Date().toISOString().split('T')[0];

    res.json(users.map(u => {
      const ua = attendance.filter(a => a.user_id === u.id);
      const sorted = [...ua].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      return {
        id: u.id, username: u.username, name: u.name, role: u.role, created_at: u.created_at,
        total_attendance: ua.length,
        today_attendance: ua.filter(a => a.date === today).length,
        last_attendance:  sorted[0] ? { date: sorted[0].date, time: sorted[0].time } : null,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅  Server Absensi berjalan di http://localhost:${PORT}`);
    console.log(`\n👤  Akun tersedia:`);
    console.log(`    admin  / admin123  → Admin`);
    console.log(`    budi   / budi123   → Budi Santoso (Pegawai)`);
    console.log(`    sari   / sari123   → Sari Dewi (Pegawai)\n`);
  });
}

module.exports = app;
