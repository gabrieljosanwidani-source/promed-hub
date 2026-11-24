const COOKIE = {
  session: 'pm_session',
  device: 'pm_device',
  admin: 'pm_admin'
};

const now = () => new Date().toISOString();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', ...extra }
});
const html = (text, status = 200) => new Response(text, {
  status,
  headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' }
});

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  const item = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookieHeader(name) {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 140) || 'file';
}
function extName(name) {
  const n = safeName(name);
  return n.slice(0, 100);
}
function guessType(file) {
  return file?.type || 'application/octet-stream';
}
function maxAgeDays(days) { return days * 24 * 60 * 60; }

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

  async function passwordHash(value, salt, iterations = 310000) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(value)),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(String(salt)),
      iterations,
      hash: 'SHA-256'
    },
    key,
    256
  );

  return [...new Uint8Array(bits)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}
const GITHUB_OWNER = 'gabrieljosanwidani-source';
const GITHUB_REPO = 'promed-files-staging';
const GITHUB_BRANCH = 'main';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PROMED_CLASSES = ['26 A', '26 B', '25 A', '25 B'];
const CLASS_CONTENT_TYPES = ['course', 'material', 'quiz', 'assignment', 'template', 'announcement'];

function validClassName(value) {
  return value === 'Semua Kelas' || PROMED_CLASSES.includes(String(value || '').trim());
}

function classScopeSql(type, alias, filter) {
  if (filter === null) return '';
  const noMapping = `NOT EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='${type}' AND cc.content_id=${alias}.id)`;
  if (filter === '__NO_CLASS__') return ` AND ${noMapping}`;
  return ` AND (${noMapping} OR EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='${type}' AND cc.content_id=${alias}.id AND cc.class_name=?))`;
}

async function getClassFilter(request, env) {
  const requested = new URL(request.url).searchParams.get('class');
  const account = await getAdminAccount(request, env);

  if (account?.role === 'super_admin') {
    if (!requested || requested === 'Semua Kelas') return null;
    return PROMED_CLASSES.includes(requested) ? requested : '__INVALID__';
  }

  if (account?.role === 'class_admin') {
    const assignedClass = account.class_name;
    if (!PROMED_CLASSES.includes(assignedClass)) return '__INVALID__';
    if (requested && requested !== 'Semua Kelas' && requested !== assignedClass) {
      return '__INVALID__';
    }
    return assignedClass;
  }

  // Admin Key lama tetap berlaku hanya sebelum Super Admin pertama dibuat.
  if (await isAdmin(request, env)) {
    if (!requested || requested === 'Semua Kelas') return null;
    return PROMED_CLASSES.includes(requested) ? requested : '__INVALID__';
  }

  if (!requested || requested === 'Semua Kelas') return '__NO_CLASS__';
  return PROMED_CLASSES.includes(requested) ? requested : '__INVALID__';
}

async function setContentClass(env, type, id, className) {
  const scope = String(className || 'Semua Kelas').trim();
  if (!CLASS_CONTENT_TYPES.includes(type) || !validClassName(scope)) {
    throw new Error('Pilihan kelas tidak valid.');
  }
  await env.DB.prepare('DELETE FROM pm_class_content WHERE content_type=? AND content_id=?').bind(type, id).run();
  if (scope !== 'Semua Kelas') {
    await env.DB.prepare('INSERT INTO pm_class_content(content_type,content_id,class_name,created_at) VALUES(?,?,?,?)')
      .bind(type, id, scope, now()).run();
  }
}

async function canViewClassContent(env, request, type, id) {
  const account = await getAdminAccount(request, env);

  if (account?.role === 'super_admin') return true;

  const row = await env.DB.prepare(
    'SELECT class_name FROM pm_class_content WHERE content_type=? AND content_id=?'
  ).bind(type, id).first();

  if (account?.role === 'class_admin') {
    if (!PROMED_CLASSES.includes(account.class_name)) return false;
    return !row || row.class_name === account.class_name;
  }

  if (await isAdmin(request, env)) return true;
  if (!row) return true;

  const requested = new URL(request.url).searchParams.get('class');
  return PROMED_CLASSES.includes(requested) && row.class_name === requested;
}


function githubHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ProMed-Hub'
  };
}

function githubPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function githubUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath(path)}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

async function githubUpload(env, path, file, message) {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN belum dipasang di Cloudflare.');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File terlalu besar. Maksimum 10 MB per file.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const content = bytesToBase64(bytes);

  const response = await fetch(githubUrl(path), {
    method: 'PUT',
    headers: {
      ...githubHeaders(env),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      content,
      branch: GITHUB_BRANCH
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.message || `GitHub upload gagal (${response.status})`
    );
  }

  return result;
}

async function githubDelete(env, path) {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN belum dipasang di Cloudflare.');
  }

  if (!path || typeof path !== 'string') {
    throw new Error('Lokasi file GitHub (file_key) kosong atau tidak valid.');
  }

  const url = githubUrl(path);
  const getResponse = await fetch(url, {
    headers: githubHeaders(env)
  });
  const getResult = await getResponse.json().catch(() => ({}));

  if (!getResponse.ok) {
    const detail = getResult.message || getResponse.statusText || 'Tidak ada detail dari GitHub.';
    throw new Error(`GitHub GET gagal (HTTP ${getResponse.status}): ${detail}`);
  }

  if (!getResult.sha) {
    throw new Error('GitHub tidak mengembalikan SHA file; file tidak dapat dihapus.');
  }

  const deleteResponse = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...githubHeaders(env),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Delete ${path}`,
      sha: getResult.sha,
      branch: GITHUB_BRANCH
    })
  });
  const deleteResult = await deleteResponse.json().catch(() => ({}));

  if (!deleteResponse.ok) {
    const detail = deleteResult.message || deleteResponse.statusText || 'Tidak ada detail dari GitHub.';
    throw new Error(`GitHub DELETE gagal (HTTP ${deleteResponse.status}): ${detail}`);
  }

  return { deleted: true };
}
async function githubRead(env, path) {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN belum dipasang di Cloudflare.');
  }

  const response = await fetch(githubUrl(path), {
    headers: {
      ...githubHeaders(env),
      'Accept': 'application/vnd.github.raw+json'
    }
  });

  if (!response.ok) {
    return null;
  }

  return response;
}
async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM pm_settings WHERE key=?').bind(key).first();
  return row?.value ?? String(fallback);
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO pm_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, String(value)).run();
}

async function currentStudent(request, env) {
  const token = cookieValue(request, COOKIE.session);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT s.id, s.npm, s.name, s.active, ss.expires_at
    FROM pm_sessions ss JOIN pm_students s ON s.id=ss.student_id
    WHERE ss.token_hash=?
  `).bind(tokenHash).first();
  if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}
async function getAdminAccount(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : cookieValue(request, COOKIE.admin);

  if (!token) return null;

  const hash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT
      a.id,
      a.username,
      a.display_name,
      a.role,
      a.class_name,
      a.must_change_password,
      s.expires_at
    FROM pm_admin_account_sessions s
    JOIN pm_admins a ON a.id = s.admin_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND a.is_active = 1
  `).bind(hash).first();

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

async function hasSuperAdmin(env) {
  const row = await env.DB.prepare(
    "SELECT id FROM pm_admins WHERE role='super_admin' LIMIT 1"
  ).first();
  return Boolean(row);
}

async function isAdmin(request, env) {
  if (await getAdminAccount(request, env)) return true;

  // Sesi Admin Key lama hanya berlaku sebelum Super Admin pertama dibuat.
  if (await hasSuperAdmin(env)) return false;

  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : cookieValue(request, COOKIE.admin);
  if (!token) return false;

  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT expires_at FROM pm_admin_sessions WHERE token_hash=?'
  ).bind(hash).first();

  return !!row && new Date(row.expires_at).getTime() > Date.now();
}
async function canManageClass(request, env, className) {
  if (!validClassName(className)) {
    return false;
  }

  const account = await getAdminAccount(request, env);

  // Super Admin boleh mengelola semua kelas.
  if (account?.role === 'super_admin') {
    return true;
  }

  // Admin Kelas hanya boleh mengelola kelasnya sendiri.
  if (account?.role === 'class_admin') {
    return (
      PROMED_CLASSES.includes(account.class_name) &&
      className === account.class_name
    );
  }

  // Admin Key lama hanya berlaku sebelum Super Admin dibuat.
  if (!account && await isAdmin(request, env)) {
    return true;
  }

  return false;
}
async function requireStudent(request, env) {
  const s = await currentStudent(request, env);
  return s;
}

async function loginStudent(request, env) {
  const data = await request.json().catch(() => ({}));
  const npm = String(data.npm || '').trim();
  const dob = String(data.birth_date || '').trim();
  if (!/^\d{8,16}$/.test(npm) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return json({message:'NPM atau tanggal lahir tidak valid.'}, 400);

  const student = await env.DB.prepare('SELECT id,npm,name,active,dob_hash FROM pm_students WHERE npm=?').bind(npm).first();
  if (!student || !student.active || student.dob_hash !== await sha256(dob)) return json({message:'NPM atau tanggal lahir tidak cocok.'}, 401);

  const deviceToken = cookieValue(request, COOKIE.device) || await randomToken(24);
  const deviceHash = await sha256(deviceToken);
  const existingDevice = await env.DB.prepare('SELECT id FROM pm_devices WHERE student_id=? AND device_hash=? AND active=1')
    .bind(student.id, deviceHash).first();

  if (!existingDevice) {
    const maxPerStudent = Number(await getSetting(env, 'max_devices_per_student', 1));
    const studentDeviceCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM pm_devices WHERE student_id=? AND active=1').bind(student.id).first();
    if (Number(studentDeviceCount?.c || 0) >= maxPerStudent) {
      return json({message:'Akun ini sudah terdaftar pada jumlah device maksimum. Hubungi admin untuk reset device.'}, 403);
    }
    const maxTotal = Number(await getSetting(env, 'max_devices', 45));
    const totalDeviceCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM pm_devices WHERE active=1').first();
    if (Number(totalDeviceCount?.c || 0) >= maxTotal) return json({message:'Slot device ProMed Hub sedang penuh. Admin perlu menambah slot terlebih dahulu.'}, 403);
    await env.DB.prepare('INSERT INTO pm_devices(student_id,device_hash,first_seen,last_seen,active) VALUES(?,?,?,?,1)')
      .bind(student.id, deviceHash, now(), now()).run();
  } else {
    await env.DB.prepare('UPDATE pm_devices SET last_seen=? WHERE id=?').bind(now(), existingDevice.id).run();
  }

  const sessionToken = await randomToken(32);
  const sessionHash = await sha256(sessionToken);
  const expires = new Date(Date.now() + maxAgeDays(30) * 1000).toISOString();
  await env.DB.prepare('INSERT INTO pm_sessions(student_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(student.id, sessionHash, now(), expires).run();

  const res = json({message:'Login berhasil.', user:{id:student.id,npm:student.npm,name:student.name}}, 200);
  res.headers.append('Set-Cookie', cookieHeader(COOKIE.session, sessionToken, maxAgeDays(30)));
  res.headers.append('Set-Cookie', cookieHeader(COOKIE.device, deviceToken, maxAgeDays(730)));
  return res;
}

async function createAdminAccountSession(env, admin) {
  const token = await randomToken(32);
  const hash = await sha256(token);
  const expires = new Date(Date.now() + maxAgeDays(1) * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO pm_admin_account_sessions
      (admin_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(admin.id, hash, now(), expires).run();

  return json({
    message: 'Login admin berhasil.',
    admin_token: token,
    admin: {
      id: admin.id,
      username: admin.username,
      display_name: admin.display_name,
      role: admin.role,
      class_name: admin.class_name || null,
      must_change_password: Number(admin.must_change_password || 0)
    }
  }, 200, {
    'Set-Cookie': cookieHeader(COOKIE.admin, token, maxAgeDays(1))
  });
}

async function adminSetupStatus(env) {
  return json({ setup_required: !(await hasSuperAdmin(env)) });
}

async function bootstrapSuperAdmin(request, env) {
  const data = await request.json().catch(() => ({}));

  if (!env.ADMIN_KEY || String(data.bootstrap_key || '') !== env.ADMIN_KEY) {
    return json({ message: 'Kunci pendaftaran awal tidak cocok.' }, 401);
  }

  const username = String(data.username || '').trim().toLowerCase();
  const displayName = String(data.display_name || '').trim();
  const password = String(data.password || '');

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json({ message: 'Username harus 3–32 karakter.' }, 400);
  }
  if (displayName.length < 2 || displayName.length > 80) {
    return json({ message: 'Nama tampilan harus 2–80 karakter.' }, 400);
  }
  if (password.length < 12 || password.length > 128) {
    return json({ message: 'Password harus 12–128 karakter.' }, 400);
  }

  const salt = await randomToken(16);
  const iterations = 310000;
  const hash = await passwordHash(password, salt, iterations);
  const timestamp = now();

  let result;
  try {
    result = await env.DB.prepare(`
      INSERT INTO pm_admins (
        username, display_name, password_hash, password_salt,
        password_iterations, role, class_name, is_active,
        must_change_password, created_at, updated_at, created_by
      )
      SELECT ?, ?, ?, ?, ?, 'super_admin', NULL, 1, 0, ?, ?, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM pm_admins WHERE role='super_admin'
      )
    `).bind(
      username, displayName, hash, salt, iterations, timestamp, timestamp
    ).run();
  } catch (error) {
    console.error('Super Admin bootstrap failed:', error);
    return json({ message: 'Akun tidak dapat dibuat. Username mungkin sudah digunakan.' }, 409);
  }

  if (Number(result.meta?.changes || 0) !== 1) {
    return json({ message: 'Akun Super Admin pertama sudah dibuat.' }, 409);
  }

  const admin = await env.DB.prepare(`
    SELECT id, username, display_name, role, class_name, must_change_password
    FROM pm_admins WHERE username = ? LIMIT 1
  `).bind(username).first();

  if (!admin) return json({ message: 'Akun tersimpan, tetapi sesi belum dapat dibuat.' }, 500);
  return createAdminAccountSession(env, admin);
}

async function loginAdmin(request, env) {
  const data = await request.json().catch(() => ({}));
  const username = String(data.username || '').trim().toLowerCase();

  if (username) {
    const password = String(data.password || '');
    const admin = await env.DB.prepare(`
      SELECT id, username, display_name, password_hash, password_salt,
             password_iterations, role, class_name, must_change_password
      FROM pm_admins
      WHERE username = ? AND is_active = 1
      LIMIT 1
    `).bind(username).first();

    if (!admin || !password) {
      return json({ message: 'Username atau password tidak cocok.' }, 401);
    }

    const candidate = await passwordHash(
      password,
      admin.password_salt,
      Number(admin.password_iterations || 310000)
    );

    if (candidate !== admin.password_hash) {
      return json({ message: 'Username atau password tidak cocok.' }, 401);
    }

    await env.DB.prepare(`
      UPDATE pm_admins SET last_login_at = ?, updated_at = ? WHERE id = ?
    `).bind(now(), now(), admin.id).run();

    return createAdminAccountSession(env, admin);
  }

  // Login Admin Key lama dinonaktifkan setelah akun Super Admin tersedia.
  if (await hasSuperAdmin(env)) {
    return json({
      message: 'Login Admin Key sudah dinonaktifkan. Gunakan username dan password.'
    }, 410);
  }

  if (!env.ADMIN_KEY || String(data.key || '') !== env.ADMIN_KEY) {
    return json({ message: 'Admin key salah.' }, 401);
  }

  const token = await randomToken(32);
  const hash = await sha256(token);
  const expires = new Date(Date.now() + maxAgeDays(1) * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO pm_admin_sessions (token_hash, created_at, expires_at)
    VALUES (?, ?, ?)
  `).bind(hash, now(), expires).run();

  return json({ message: 'Login admin berhasil.', admin_token: token }, 200, {
    'Set-Cookie': cookieHeader(COOKIE.admin, token, maxAgeDays(1))
  });
}

async function logoutStudent(env, request) {
  const token = cookieValue(request, COOKIE.session);
  if (token) await env.DB.prepare('DELETE FROM pm_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  const headers = new Headers({ 'content-type':'application/json; charset=UTF-8' });
  headers.append('Set-Cookie', clearCookieHeader(COOKIE.session));
  return json({message:'Logout berhasil.'}, 200, Object.fromEntries(headers));
}
async function logoutAdmin(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : cookieValue(request, COOKIE.admin);

  if (token) {
    const hash = await sha256(token);
    await env.DB.prepare(`
      UPDATE pm_admin_account_sessions
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).bind(now(), hash).run();
    await env.DB.prepare(
      'DELETE FROM pm_admin_sessions WHERE token_hash = ?'
    ).bind(hash).run();
  }

  return json({ message: 'Logout admin berhasil.' }, 200, {
    'Set-Cookie': clearCookieHeader(COOKIE.admin)
  });
}

function userPayload(user) {
  return {id:user.id,npm:user.npm,name:user.name};
}
async function openMaterialFile(request, env, id) {
  if (!(await canViewClassContent(env, request, 'material', id))) return new Response('Materi ini tidak tersedia untuk kelas yang dipilih.', { status: 404 });
  const row = await env.DB
    .prepare(`
      SELECT file_key, file_name, content_type
      FROM pm_materials
      WHERE id=? AND status='published'
    `)
    .bind(id)
    .first();

  if (!row) {
    return new Response('Materi tidak ditemukan', { status: 404 });
  }

  if (!row.file_key) {
    return new Response('File materi belum tersedia', { status: 404 });
  }

  const response = await githubRead(env, row.file_key);

  if (!response) {
    return new Response('File materi tidak ditemukan', { status: 404 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeName(row.file_name)}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
async function openTemplateFile(request, env, id) {
  if (!(await canViewClassContent(env, request, 'template', id))) return new Response('Template ini tidak tersedia untuk kelas yang dipilih.', { status: 404 });
  const row = await env.DB
    .prepare(`
      SELECT file_key, file_name, content_type
      FROM pm_templates
      WHERE id=? AND status='published'
    `)
    .bind(id)
    .first();

  if (!row) {
    return new Response('Template tidak ditemukan', { status: 404 });
  }

  const response = await githubRead(env, row.file_key);

  if (!response) {
    return new Response('File template tidak ditemukan', { status: 404 });
  }

  return new Response(response.body, {
      status: 200,
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${row.file_name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
async function openAssignmentFile(request, env, id) {
  if (!(await canViewClassContent(env, request, 'assignment', id))) {
    return new Response('Lampiran tugas ini tidak tersedia untuk kelas yang dipilih.', { status: 404 });
  }

  const row = await env.DB.prepare(`
    SELECT f.file_key,f.file_name,f.content_type
    FROM pm_assignment_files f
    JOIN pm_assignments a ON a.id=f.assignment_id
    WHERE f.assignment_id=? AND a.status='active'
  `).bind(id).first();

  if (!row) return new Response('Lampiran tugas tidak ditemukan.', { status: 404 });

  const response = await githubRead(env, row.file_key);
  if (!response) return new Response('File lampiran tidak ditemukan.', { status: 404 });

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName(row.file_name)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function listMaterials(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT m.id,m.title,m.course,m.course_id,m.meeting,m.source_url,m.file_name,m.content_type,m.uploaded_at,m.status,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='material' AND cc.content_id=m.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_materials m WHERE m.status='published' ${classScopeSql('material','m',filter)} ORDER BY m.uploaded_at DESC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}
async function listQuizzes(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT q.id,q.title,q.course,q.course_id,q.meeting,q.file_name,q.content_type,q.uploaded_at,q.status,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='quiz' AND cc.content_id=q.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_quizzes q WHERE q.status='published' ${classScopeSql('quiz','q',filter)} ORDER BY q.uploaded_at DESC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}
async function listAssignments(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT a.id,a.title,a.course,a.course_id,a.instructions,a.deadline,a.created_at,a.status,
    af.file_name AS attachment_name,
    CASE WHEN af.file_key IS NOT NULL THEN 1 ELSE 0 END AS has_attachment,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='assignment' AND cc.content_id=a.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_assignments a
    LEFT JOIN pm_assignment_files af ON af.assignment_id=a.id
    WHERE a.status='active' ${classScopeSql('assignment','a',filter)}
    ORDER BY CASE WHEN a.deadline IS NULL OR a.deadline='' THEN 1 ELSE 0 END, a.deadline`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}
async function listTemplates(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT t.id,t.course_id,t.title,t.description,
           CASE WHEN t.file_key IS NOT NULL AND t.file_key <> '' THEN 1 ELSE 0 END AS has_file,
           t.file_name,t.content_type,t.uploaded_at,t.status,
           COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='template' AND cc.content_id=t.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_templates t WHERE t.status='published' ${classScopeSql('template','t',filter)} ORDER BY t.uploaded_at DESC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}
async function listCourses(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT c.id,c.name,c.semester,c.lecturer,c.description,c.status,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_courses c WHERE c.status='active' ${classScopeSql('course','c',filter)} ORDER BY c.semester ASC,c.name ASC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}
async function adminCreateMaterial(request, env) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return json({ message: 'Pilih file materi terlebih dahulu.' }, 400);
  }

  const title = String(form.get('title') || '').trim();
  const course = String(form.get('course') || '').trim();
  const meeting = String(form.get('meeting') || '').trim();
  const sourceUrl = String(form.get('source_url') || '').trim();
  const className = String(form.get('class_name') || 'Semua Kelas').trim();
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);
  if (!(await canManageClass(request, env, className))) {
  return json({
    message: 'Akun ini tidak memiliki akses untuk mengelola kelas tersebut.'
  }, 403);
}

  if (!title || !course) {
    return json({
      message: 'Judul dan mata kuliah wajib diisi.'
    }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return json({
      message: 'File terlalu besar. Maksimum 10 MB.'
    }, 413);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `materials/${crypto.randomUUID()}-${safeName}`;

  await githubUpload(
    env,
    key,
    file,
    `Upload materi: ${title}`
  );

  const result = await env.DB.prepare(`
    INSERT INTO pm_materials
    (title, course, meeting, source_url, file_key, file_name,
     content_type, uploaded_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      title,
      course,
      meeting,
      sourceUrl,
      key,
      file.name,
      file.type || 'application/octet-stream',
      now(),
      'published'
    )
    .run();

  await setContentClass(env, 'material', result.meta.last_row_id, className);

  return json({
    message: className === 'Semua Kelas' ? 'Materi berhasil dipublikasikan untuk semua kelas.' : `Materi berhasil dipublikasikan untuk kelas ${className}.`,
    id: result.meta.last_row_id,
    file_key: key
  });
}

async function adminCreateQuiz(request, env) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return json({
      message: 'Pilih file kuis HTML/JSON terlebih dahulu.'
    }, 400);
  }

  const title = String(form.get('title') || '').trim();
  const course = String(form.get('course') || '').trim();
  const meeting = String(form.get('meeting') || '').trim();
  const className = String(form.get('class_name') || 'Semua Kelas').trim();
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);
  if (!(await canManageClass(request, env, className))) {
  return json({
    message: 'Akun ini tidak memiliki akses untuk mengelola kelas tersebut.'
  }, 403);
}

  if (!title || !course) {
    return json({
      message: 'Judul dan mata kuliah wajib diisi.'
    }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return json({
      message: 'File terlalu besar. Maksimum 10 MB.'
    }, 413);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `quizzes/${crypto.randomUUID()}-${safeName}`;

  await githubUpload(
    env,
    key,
    file,
    `Upload kuis: ${title}`
  );

  const result = await env.DB.prepare(`
    INSERT INTO pm_quizzes
    (title, course, meeting, file_key, file_name,
     content_type, uploaded_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      title,
      course,
      meeting,
      key,
      file.name,
      file.type || 'application/octet-stream',
      now(),
      'published'
    )
    .run();

  await setContentClass(env, 'quiz', result.meta.last_row_id, className);

  return json({
    message: className === 'Semua Kelas' ? 'Kuis berhasil dipublikasikan untuk semua kelas.' : `Kuis berhasil dipublikasikan untuk kelas ${className}.`,
    id: result.meta.last_row_id,
    file_key: key
  });
}

async function adminCreateTemplate(request, env) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return json({ message: 'Pilih file template terlebih dahulu.' }, 400);
  }

  const title = String(form.get('title') || '').trim();
  const courseId = Number(form.get('course_id'));
  const description = String(form.get('description') || '').trim();
  const className = String(form.get('class_name') || 'Semua Kelas').trim();
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);
  if (!(await canManageClass(request, env, className))) {
  return json({
    message: 'Akun ini tidak memiliki akses untuk mengelola kelas tersebut.'
  }, 403);
}

  if (!title || !Number.isInteger(courseId) || courseId <= 0) {
    return json({
      message: 'Judul dan mata kuliah wajib diisi.'
    }, 400);
  }

  const course = await env.DB
    .prepare("SELECT id FROM pm_courses WHERE id=? AND status='active'")
    .bind(courseId)
    .first();

  if (!course) {
    return json({ message: 'Mata kuliah tidak ditemukan.' }, 404);
  }

  if (!(await canViewClassContent(env, request, 'course', courseId))) {
    return json({ message: 'Mata kuliah tersebut bukan milik kelas akun admin ini.' }, 403);
  }

  if (file.size > MAX_FILE_SIZE) {
    return json({
      message: 'File terlalu besar. Maksimum 10 MB.'
    }, 413);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `templates/${crypto.randomUUID()}-${safeName}`;

  await githubUpload(
    env,
    key,
    file,
    `Upload template: ${title}`
  );

  const result = await env.DB.prepare(`
    INSERT INTO pm_templates
    (course_id, title, description, file_key, file_name,
     content_type, uploaded_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      courseId,
      title,
      description,
      key,
      file.name,
      file.type || 'application/octet-stream',
      now(),
      'published'
    )
    .run();

  await setContentClass(env, 'template', result.meta.last_row_id, className);

  return json({
    message: className === 'Semua Kelas' ? 'Template berhasil dipublikasikan untuk semua kelas.' : `Template berhasil dipublikasikan untuk kelas ${className}.`,
    id: result.meta.last_row_id,
    file_key: key
  });
}

async function adminCreateAssignment(request, env) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);

  const contentType = request.headers.get('content-type') || '';
  let data = {};
  let file = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    data = {
      title: form.get('title'),
      course: form.get('course'),
      instructions: form.get('instructions'),
      deadline: form.get('deadline'),
      class_name: form.get('class_name')
    };
    const candidate = form.get('file');
    if (candidate instanceof File && candidate.size > 0) file = candidate;
  } else {
    // Kompatibilitas untuk klien lama yang masih mengirim JSON.
    data = await request.json().catch(() => ({}));
  }

  const title = String(data.title || '').trim();
  const course = String(data.course || '').trim();
  const instructions = String(data.instructions || '').trim();
  const deadline = String(data.deadline || '').trim();
  const className = String(data.class_name || 'Semua Kelas').trim();

  if (!title || !course) return json({ message: 'Judul dan mata kuliah wajib diisi.' }, 400);
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);
  if (!(await canManageClass(request, env, className))) {
  return json({
    message: 'Akun ini tidak memiliki akses untuk mengelola kelas tersebut.'
  }, 403);
}

  const allowedExtensions = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','jpg','jpeg','png','txt']);
  if (file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return json({ message: 'Format lampiran tidak didukung. Gunakan PDF, Word, PowerPoint, Excel, JPG, PNG, atau TXT.' }, 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return json({ message: 'Lampiran terlalu besar. Maksimum 10 MB.' }, 413);
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO pm_assignments(title,course,instructions,deadline,created_at,status) VALUES(?,?,?,?,?,?)`
  ).bind(title, course, instructions, deadline, now(), 'active').run();

  const assignmentId = Number(result.meta.last_row_id);
  let uploadedKey = null;

  try {
    await setContentClass(env, 'assignment', assignmentId, className);

    if (file) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      uploadedKey = `assignments/${crypto.randomUUID()}-${cleanName}`;
      await githubUpload(env, uploadedKey, file, `Upload lampiran tugas: ${title}`);
      await env.DB.prepare(
        `INSERT INTO pm_assignment_files(assignment_id,file_key,file_name,content_type,uploaded_at) VALUES(?,?,?,?,?)`
      ).bind(assignmentId, uploadedKey, file.name, file.type || 'application/octet-stream', now()).run();
    }
  } catch (error) {
    if (uploadedKey) {
      try { await githubDelete(env, uploadedKey); }
      catch (cleanupError) { console.error('Gagal membersihkan lampiran tugas:', cleanupError); }
    }
    try {
      await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='assignment' AND content_id=?").bind(assignmentId).run();
    } catch (cleanupError) {
      console.error('Gagal membersihkan pemetaan kelas tugas:', cleanupError);
    }
    try {
      await env.DB.prepare('DELETE FROM pm_assignments WHERE id=?').bind(assignmentId).run();
    } catch (cleanupError) {
      console.error('Gagal membersihkan data tugas:', cleanupError);
    }
    console.error('Gagal membuat tugas:', error);
    return json({ message: error instanceof Error ? `Tugas gagal dibuat: ${error.message}` : 'Tugas gagal dibuat.' }, 500);
  }

  const attachmentMessage = file ? ' Lampiran berhasil ditambahkan.' : '';
  return json({
    message: (className === 'Semua Kelas' ? 'Tugas dibuat untuk semua kelas.' : `Tugas dibuat untuk kelas ${className}.`) + attachmentMessage,
    id: assignmentId,
    has_attachment: Boolean(file)
  });
}

async function adminDeleteMaterial(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const row = await env.DB
    .prepare('SELECT file_key FROM pm_materials WHERE id=?')
    .bind(id)
    .first();

  if (!row) {
    return json({ message: 'Materi tidak ditemukan.' }, 404);
  }

  await githubDelete(env, row.file_key);

  await env.DB.prepare('DELETE FROM pm_materials WHERE id=?').bind(id).run();
  await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='material' AND content_id=?").bind(id).run();

  return json({ message: 'Materi dihapus.' });
}
async function adminDeleteQuiz(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const row = await env.DB
    .prepare('SELECT file_key FROM pm_quizzes WHERE id=?')
    .bind(id)
    .first();

  if (!row) {
    return json({ message: 'Kuis tidak ditemukan.' }, 404);
  }

  await githubDelete(env, row.file_key);

  await env.DB.prepare('DELETE FROM pm_quizzes WHERE id=?').bind(id).run();
  await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='quiz' AND content_id=?").bind(id).run();

  return json({ message: 'Kuis dihapus.' });
}

async function adminDeleteTemplate(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  let row;
  try {
    row = await env.DB
      .prepare('SELECT file_key FROM pm_templates WHERE id=?')
      .bind(id)
      .first();
  } catch (error) {
    console.error('Template lookup failed:', error);
    return json({ message: 'Gagal membaca data template dari database.' }, 500);
  }

  if (!row) {
    return json({ message: 'Template tidak ditemukan.' }, 404);
  }

  // Hapus file di GitHub terlebih dahulu. Jika gagal, pertahankan baris D1
  // agar template tidak hilang dari daftar sementara file-nya masih ada.
  if (row.file_key) {
    try {
      await githubDelete(env, row.file_key);
    } catch (error) {
      console.error('GitHub template deletion failed:', error);
      const detail = error instanceof Error ? error.message : 'Kesalahan GitHub API.';
      return json({
        message: `File template gagal dihapus dari GitHub: ${detail}`
      }, 502);
    }
  }

  try {
    await env.DB
      .prepare('DELETE FROM pm_templates WHERE id=?')
      .bind(id)
      .run();
  } catch (error) {
    console.error('Template database deletion failed:', error);
    return json({
      message: 'File sudah diproses, tetapi data template di database gagal dihapus.'
    }, 500);
  }

  await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='template' AND content_id=?").bind(id).run();
  return json({ message: 'Template berhasil dihapus.' });
}

async function adminDeleteAssignment(request, env, id) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);

  const attachment = await env.DB.prepare(
    'SELECT file_key FROM pm_assignment_files WHERE assignment_id=?'
  ).bind(id).first();

  if (attachment?.file_key) {
    try {
      await githubDelete(env, attachment.file_key);
    } catch (error) {
      console.error('Gagal menghapus lampiran tugas:', error);
      return json({ message: 'Lampiran gagal dihapus dari penyimpanan. Data tugas dipertahankan.' }, 502);
    }
  }

  await env.DB.prepare('DELETE FROM pm_assignment_files WHERE assignment_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM pm_assignments WHERE id=?').bind(id).run();
  await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='assignment' AND content_id=?").bind(id).run();
  return json({ message: 'Tugas dan lampirannya berhasil dihapus.' });
}

async function addStudent(request, env) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  const data=await request.json().catch(()=>({}));
  const npm=String(data.npm||'').trim(),name=String(data.name||'').trim(),dob=String(data.birth_date||'').trim();
  if(!/^\d{8,16}$/.test(npm)||!name||!/^\d{4}-\d{2}-\d{2}$/.test(dob))return json({message:'Isi NPM, nama, dan tanggal lahir dengan benar.'},400);
  try{
    const r=await env.DB.prepare('INSERT INTO pm_students(npm,name,dob_hash,active,created_at) VALUES(?,?,?,?,?)').bind(npm,name,await sha256(dob),1,now()).run();
    return json({message:'Mahasiswa ditambahkan.',id:r.meta.last_row_id});
  }catch{return json({message:'NPM sudah terdaftar.'},409)}
}
async function listAdminCourses(env, request) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT c.id,c.name,c.semester,c.lecturer,c.description,c.status,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_courses c ${filter === null ? '' : `WHERE ${classScopeSql('course','c',filter).replace(/^ AND /,'')}`} ORDER BY c.semester ASC,c.name ASC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}

async function adminCreateCourse(request, env) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);
  const data = await request.json().catch(() => ({}));
  const name = String(data.name || '').trim();
  const semester = Number(data.semester);
  const lecturer = String(data.lecturer || '').trim();
  const description = String(data.description || '').trim();
  const className = String(data.class_name || 'Semua Kelas').trim();

  if (!name || !Number.isInteger(semester) || semester < 1 || semester > 8) {
    return json({ message: 'Nama mata kuliah dan semester 1–8 wajib diisi.' }, 400);
  }
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);

  const duplicateSql = `SELECT c.id FROM pm_courses c
    WHERE lower(c.name)=lower(?) AND c.semester=?
    AND (NOT EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id)
      OR EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id AND cc.class_name=?)
      OR ?='Semua Kelas')`;
  const duplicate = await env.DB.prepare(duplicateSql).bind(name, semester, className, className).first();
  if (duplicate) return json({ message: 'Mata kuliah tersebut sudah terdaftar untuk kelas ini pada semester yang sama.' }, 409);

  const result = await env.DB.prepare(`
    INSERT INTO pm_courses (name, semester, lecturer, description, status, created_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).bind(name, semester, lecturer, description, now()).run();
  await setContentClass(env, 'course', result.meta.last_row_id, className);

  return json({
    ok: true,
    message: className === 'Semua Kelas' ? 'Mata kuliah berhasil ditambahkan untuk semua kelas.' : `Mata kuliah berhasil ditambahkan untuk kelas ${className}.`,
    id: result.meta.last_row_id
  });
}

async function adminUpdateCourse(request, env, id) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);
  const data = await request.json().catch(() => ({}));
  const name = String(data.name || '').trim();
  const semester = Number(data.semester);
  const lecturer = String(data.lecturer || '').trim();
  const description = String(data.description || '').trim();
  const className = String(data.class_name || 'Semua Kelas').trim();

  if (!name || !Number.isInteger(semester) || semester < 1 || semester > 8) {
    return json({ message: 'Nama mata kuliah dan semester 1–8 wajib diisi.' }, 400);
  }
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);

  const course = await env.DB.prepare('SELECT id FROM pm_courses WHERE id=?').bind(id).first();
  if (!course) return json({ message: 'Mata kuliah tidak ditemukan.' }, 404);

  const duplicateSql = `SELECT c.id FROM pm_courses c
    WHERE lower(c.name)=lower(?) AND c.semester=? AND c.id!=?
    AND (NOT EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id)
      OR EXISTS (SELECT 1 FROM pm_class_content cc WHERE cc.content_type='course' AND cc.content_id=c.id AND cc.class_name=?)
      OR ?='Semua Kelas')`;
  const duplicate = await env.DB.prepare(duplicateSql).bind(name, semester, id, className, className).first();
  if (duplicate) return json({ message: 'Nama mata kuliah sudah digunakan pada kelas dan semester tersebut.' }, 409);

  await env.DB.prepare(`
    UPDATE pm_courses SET name=?,semester=?,lecturer=?,description=? WHERE id=?
  `).bind(name, semester, lecturer, description, id).run();
  await setContentClass(env, 'course', id, className);

  return json({ ok: true, message: 'Mata kuliah berhasil diperbarui.' });
}
async function listAnnouncements(env, request) {
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT a.id,a.title,a.content,a.category,a.is_pinned,a.status,a.created_at,a.updated_at
    FROM pm_announcements a WHERE a.status='published' ${classScopeSql('announcement','a',filter)}
    ORDER BY a.is_pinned DESC,a.created_at DESC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}

async function adminListAnnouncements(env, request) {
  if (!(await isAdmin(request, env))) return json({ message: 'Belum login admin.' }, 401);
  const filter = await getClassFilter(request, env);
  if (filter === '__INVALID__') return json({ message: 'Kelas tidak valid.' }, 400);
  const sql = `SELECT a.id,a.title,a.content,a.category,a.is_pinned,a.status,a.created_at,a.updated_at,
    COALESCE((SELECT cc.class_name FROM pm_class_content cc WHERE cc.content_type='announcement' AND cc.content_id=a.id LIMIT 1),'Semua Kelas') AS class_name
    FROM pm_announcements a ${filter === null ? '' : `WHERE ${classScopeSql('announcement','a',filter).replace(/^ AND /,'')}`} ORDER BY a.created_at DESC`;
  const stmt = env.DB.prepare(sql);
  const q = filter && filter !== '__NO_CLASS__' ? await stmt.bind(filter).all() : await stmt.all();
  return json({ items: q.results || [] });
}

async function adminCreateAnnouncement(request, env) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const title = String(data.title || '').trim();
  const content = String(data.content || '').trim();
  const category = String(data.category || 'informasi').trim();
  const isPinned = data.is_pinned ? 1 : 0;
  const className = String(data.class_name || 'Semua Kelas').trim();
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);

  const allowedCategories = [
    'akademik',
    'informasi',
    'penting',
    'kegiatan'
  ];

  if (!title || !content) {
    return json({
      message: 'Judul dan isi pengumuman wajib diisi.'
    }, 400);
  }

  if (title.length > 160 || content.length > 10000) {
    return json({
      message: 'Judul maksimal 160 karakter dan isi maksimal 10.000 karakter.'
    }, 400);
  }

  if (!allowedCategories.includes(category)) {
    return json({
      message: 'Kategori pengumuman tidak valid.'
    }, 400);
  }

  const timestamp = now();

  const result = await env.DB.prepare(`
    INSERT INTO pm_announcements
      (title, content, category, is_pinned, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'published', ?, ?)
  `).bind(
    title,
    content,
    category,
    isPinned,
    timestamp,
    timestamp
  ).run();

  await setContentClass(env, 'announcement', result.meta.last_row_id, className);

  return json({
    ok: true,
    message: className === 'Semua Kelas' ? 'Pengumuman berhasil dipublikasikan untuk semua kelas.' : `Pengumuman berhasil dipublikasikan untuk kelas ${className}.`,
    id: result.meta.last_row_id
  });
}

async function adminUpdateAnnouncement(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const title = String(data.title || '').trim();
  const content = String(data.content || '').trim();
  const category = String(data.category || 'informasi').trim();
  const isPinned = data.is_pinned ? 1 : 0;
  const className = String(data.class_name || 'Semua Kelas').trim();
  if (!validClassName(className)) return json({ message: 'Kelas yang dipilih tidak valid.' }, 400);

  const allowedCategories = [
    'akademik',
    'informasi',
    'penting',
    'kegiatan'
  ];

  if (!title || !content) {
    return json({
      message: 'Judul dan isi pengumuman wajib diisi.'
    }, 400);
  }

  if (title.length > 160 || content.length > 10000) {
    return json({
      message: 'Judul maksimal 160 karakter dan isi maksimal 10.000 karakter.'
    }, 400);
  }

  if (!allowedCategories.includes(category)) {
    return json({
      message: 'Kategori pengumuman tidak valid.'
    }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM pm_announcements WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return json({ message: 'Pengumuman tidak ditemukan.' }, 404);
  }

  await env.DB.prepare(`
    UPDATE pm_announcements
    SET title = ?, content = ?, category = ?,
        is_pinned = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    title,
    content,
    category,
    isPinned,
    now(),
    id
  ).run();

  await setContentClass(env, 'announcement', id, className);

  return json({
    ok: true,
    message: 'Pengumuman berhasil diperbarui.'
  });
}

async function adminSetAnnouncementStatus(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const status = String(data.status || '').trim();

  if (!['published', 'archived'].includes(status)) {
    return json({ message: 'Status pengumuman tidak valid.' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM pm_announcements WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return json({ message: 'Pengumuman tidak ditemukan.' }, 404);
  }

  await env.DB.prepare(`
    UPDATE pm_announcements
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, now(), id).run();

  return json({
    ok: true,
    message: status === 'published'
      ? 'Pengumuman berhasil dipublikasikan kembali.'
      : 'Pengumuman berhasil diarsipkan.'
  });
}

async function adminDeleteAnnouncement(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const result = await env.DB.prepare(
    'DELETE FROM pm_announcements WHERE id = ?'
  ).bind(id).run();

  if (!result.meta.changes) {
    return json({ message: 'Pengumuman tidak ditemukan.' }, 404);
  }

  await env.DB.prepare("DELETE FROM pm_class_content WHERE content_type='announcement' AND content_id=?").bind(id).run();

  return json({
    ok: true,
    message: 'Pengumuman berhasil dihapus.'
  });
}
async function adminSetCourseStatus(request, env, id) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const status = String(data.status || '').trim();

  if (!['active', 'inactive'].includes(status)) {
    return json({
      message: 'Status mata kuliah tidak valid.'
    }, 400);
  }

  const course = await env.DB.prepare(
    'SELECT id FROM pm_courses WHERE id = ?'
  ).bind(id).first();

  if (!course) {
    return json({
      message: 'Mata kuliah tidak ditemukan.'
    }, 404);
  }

  await env.DB.prepare(`
    UPDATE pm_courses
    SET status = ?
    WHERE id = ?
  `).bind(status, id).run();

  return json({
    ok: true,
    message: status === 'active'
      ? 'Mata kuliah berhasil diaktifkan kembali.'
      : 'Mata kuliah berhasil dinonaktifkan.'
  });
}
async function listStudents(env, request) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  const q=await env.DB.prepare(`SELECT s.id,s.npm,s.name,s.active,COUNT(d.id) AS devices FROM pm_students s LEFT JOIN pm_devices d ON d.student_id=s.id AND d.active=1 GROUP BY s.id ORDER BY s.name`).all();
  return json({items:q.results||[]});
}
async function resetStudentDevice(env, request, id) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  await env.DB.prepare('UPDATE pm_devices SET active=0 WHERE student_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM pm_sessions WHERE student_id=?').bind(id).run();
  return json({message:'Device mahasiswa berhasil di-reset. Mahasiswa dapat login kembali di device baru.'});
}

async function updateSettings(env, request) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  const data=await request.json().catch(()=>({}));
  const maxDevices=Math.max(1,Math.min(100000,Number(data.max_devices||45)));
  const perStudent=Math.max(1,Math.min(10,Number(data.max_devices_per_student||1)));
  await setSetting(env,'max_devices',maxDevices);await setSetting(env,'max_devices_per_student',perStudent);
  return getAdminSummary(env,request);
}
async function getAdminSummary(env, request) {
  if (!(await isAdmin(request, env))) {
    return json({ message: 'Belum login admin.' }, 401);
  }

  // Samakan cakupan ringkasan dengan daftar konten. Untuk Admin Kelas,
  // hitungan hanya mencakup kelas penugasannya dan konten bersama.
  const classFilter = await getClassFilter(request, env);
  if (classFilter === '__INVALID__') {
    return json({ message: 'Kelas tidak valid.' }, 400);
  }

  const countContent = async (table, type, status) => {
    const scope = classFilter === null
      ? ''
      : classScopeSql(type, 'c', classFilter);
    const statement = env.DB.prepare(
      `SELECT COUNT(*) AS c FROM ${table} c WHERE c.status=?${scope}`
    );
    const values = [status];

    if (classFilter !== null && classFilter !== '__NO_CLASS__') {
      values.push(classFilter);
    }

    const row = await statement.bind(...values).first();
    return Number(row?.c || 0);
  };

  const [courses, materials, quizzes, assignments, templates, announcements] =
    await Promise.all([
      countContent('pm_courses', 'course', 'active'),
      countContent('pm_materials', 'material', 'published'),
      countContent('pm_quizzes', 'quiz', 'published'),
      countContent('pm_assignments', 'assignment', 'active'),
      countContent('pm_templates', 'template', 'published'),
      countContent('pm_announcements', 'announcement', 'published')
    ]);

  return json({
    courses,
    materials,
    quizzes,
    assignments,
    templates,
    announcements
  });
}

async function readAdminClassName(request) {
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const data = await request.clone().json();
      return String(data.class_name || '').trim();
    }
    if (contentType.includes('multipart/form-data')) {
      const form = await request.clone().formData();
      return String(form.get('class_name') || '').trim();
    }
  } catch (error) {
    console.error('Tidak dapat membaca kelas dari request admin:', error);
  }
  return '';
}

function adminContentTypeFromPath(path) {
  if (path.includes('/courses')) return 'course';
  if (path.includes('/materials')) return 'material';
  if (path.includes('/quizzes')) return 'quiz';
  if (path.includes('/assignments')) return 'assignment';
  if (path.includes('/templates')) return 'template';
  if (path.includes('/announcements')) return 'announcement';
  return null;
}

async function authorizeAdminRequest(request, env, path) {
  const account = await getAdminAccount(request, env);

  if (!account) {
    if (await isAdmin(request, env)) return null;
    return json({ message: 'Belum login admin.' }, 401);
  }

    const method = request.method.toUpperCase();

  if (
    Number(account.must_change_password || 0) === 1 &&
    !(method === 'POST' && path === '/api/admin/change-password')
  ) {
    return json({
      message: 'Silakan ganti password awal terlebih dahulu.'
    }, 403);
  }

  if (account.role === 'super_admin') return null;

  if (
    account.role !== 'class_admin' ||
    !PROMED_CLASSES.includes(account.class_name)
  ) {
    return json({
      message: 'Peran atau kelas akun admin tidak valid.'
    }, 403);
  }

  const assignedClass = account.class_name;

  // Admin Kelas dapat membaca ringkasan yang dibatasi ke kelasnya,
  // serta daftar konten untuk kelas yang menjadi tanggung jawabnya.
  if (method === 'GET' && [
    '/api/admin/summary',
    '/api/admin/courses',
    '/api/admin/announcements'
  ].includes(path)) {
    return null;
  }

  // Admin Kelas tidak boleh membaca ringkasan global, pengaturan, data akun,
  // ataupun endpoint administrasi lain di luar pengelolaan konten kelas.
  if (method === 'POST' && path === '/api/admin/change-password') return null;
  if (path.startsWith('/api/admin/accounts')) {
    return json({ message: 'Hanya Super Admin yang dapat mengelola akun admin.' }, 403);
  }

  const createRoutes = new Set([
    '/api/admin/courses',
    '/api/admin/materials',
    '/api/admin/quizzes',
    '/api/admin/assignments',
    '/api/admin/templates',
    '/api/admin/announcements'
  ]);

  if (method === 'POST' && createRoutes.has(path)) {
    const requestedClass = await readAdminClassName(request);
    if (requestedClass !== assignedClass) {
      return json({
        message: `Admin ini hanya boleh membuat konten untuk kelas ${assignedClass}.`
      }, 403);
    }
    return null;
  }

  const contentType = adminContentTypeFromPath(path);
  if (!contentType) {
    return json({ message: 'Akses ini hanya tersedia untuk Super Admin.' }, 403);
  }

  const idMatch = path.match(/\/(\d+)(?:\/status)?$/);
  if (!idMatch || !['PUT', 'PATCH', 'DELETE'].includes(method)) {
    return json({ message: 'Aksi admin tidak diizinkan.' }, 403);
  }

  const contentId = Number(idMatch[1]);
  if (!Number.isInteger(contentId) || contentId <= 0) {
    return json({ message: 'ID konten tidak valid.' }, 400);
  }

  const mapping = await env.DB.prepare(`
    SELECT class_name FROM pm_class_content
    WHERE content_type = ? AND content_id = ?
    LIMIT 1
  `).bind(contentType, contentId).first();

  // Data tanpa pemetaan dianggap konten bersama (Semua Kelas), sehingga
  // tidak boleh diubah atau dihapus oleh Admin Kelas.
  if (!mapping || mapping.class_name !== assignedClass) {
    return json({ message: `Konten ini bukan milik kelas ${assignedClass}.` }, 403);
  }

  // Saat mengubah konten, class_name tidak boleh diganti ke kelas lain
  // atau menjadi Semua Kelas.
  if (method === 'PUT') {
    const requestedClass = await readAdminClassName(request);
    if (requestedClass !== assignedClass) {
      return json({ message: `Konten harus tetap berada di kelas ${assignedClass}.` }, 403);
    }
  }

  return null;
}

async function requireSuperAdmin(request, env) {
  const account = await getAdminAccount(request, env);
  if (!account || account.role !== 'super_admin') {
    return { error: json({ message: 'Akses khusus Super Admin.' }, 403) };
  }
  return { account };
}

async function adminListAccounts(request, env) {
  const auth = await requireSuperAdmin(request, env);
  if (auth.error) return auth.error;
  const q = await env.DB.prepare(`
    SELECT id, username, display_name, role, class_name, is_active,
           must_change_password, created_at, updated_at, last_login_at
    FROM pm_admins
    ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END, class_name, username
  `).all();
  return json({ items: q.results || [] });
}

async function adminCreateClassAccount(request, env) {
  const auth = await requireSuperAdmin(request, env);
  if (auth.error) return auth.error;

  const data = await request.json().catch(() => ({}));
  const username = String(data.username || '').trim().toLowerCase();
  const displayName = String(data.display_name || '').trim();
  const password = String(data.password || '');
  const className = String(data.class_name || '').trim();

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json({ message: 'Username harus 3–32 karakter.' }, 400);
  }
  if (displayName.length < 2 || displayName.length > 80) {
    return json({ message: 'Nama tampilan harus 2–80 karakter.' }, 400);
  }
  if (password.length < 12 || password.length > 128) {
    return json({ message: 'Password awal harus 12–128 karakter.' }, 400);
  }
  if (!PROMED_CLASSES.includes(className)) {
    return json({ message: 'Pilih satu kelas yang valid untuk Admin Kelas.' }, 400);
  }

  const salt = await randomToken(16);
  const iterations = 310000;
  const hash = await passwordHash(password, salt, iterations);
  try {
    const result = await env.DB.prepare(`
      INSERT INTO pm_admins (
        username, display_name, password_hash, password_salt,
        password_iterations, role, class_name, is_active,
        must_change_password, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, 'class_admin', ?, 1, 1, ?, ?, ?)
    `).bind(
      username, displayName, hash, salt, iterations, className,
      now(), now(), auth.account.id
    ).run();

    return json({
      message: `Admin Kelas untuk ${className} berhasil dibuat.`,
      id: result.meta.last_row_id,
      username,
      class_name: className,
      must_change_password: 1
    }, 201);
  } catch (error) {
    console.error('Create class admin failed:', error);
    return json({ message: 'Akun gagal dibuat. Username mungkin sudah digunakan.' }, 409);
  }
}

async function adminSetAccountActive(request, env, id) {
  const auth = await requireSuperAdmin(request, env);
  if (auth.error) return auth.error;
  const data = await request.json().catch(() => ({}));
  const active = data.is_active === true || data.is_active === 1 || data.is_active === '1' ? 1 :
    data.is_active === false || data.is_active === 0 || data.is_active === '0' ? 0 : null;
  if (active === null) return json({ message: 'Status akun tidak valid.' }, 400);

  const target = await env.DB.prepare(
    'SELECT id, role FROM pm_admins WHERE id = ?'
  ).bind(id).first();
  if (!target) return json({ message: 'Akun admin tidak ditemukan.' }, 404);
  if (target.role === 'super_admin' || Number(target.id) === Number(auth.account.id)) {
    return json({ message: 'Akun Super Admin utama tidak dapat dinonaktifkan melalui fitur ini.' }, 403);
  }

  await env.DB.prepare(`
    UPDATE pm_admins SET is_active = ?, updated_at = ? WHERE id = ?
  `).bind(active, now(), id).run();
  if (!active) {
    await env.DB.prepare(`
      UPDATE pm_admin_account_sessions SET revoked_at = ?
      WHERE admin_id = ? AND revoked_at IS NULL
    `).bind(now(), id).run();
  }
  return json({ message: active ? 'Akun admin diaktifkan.' : 'Akun admin dinonaktifkan.' });
}

async function adminResetAccountPassword(request, env, id) {
  const auth = await requireSuperAdmin(request, env);
  if (auth.error) return auth.error;
  const data = await request.json().catch(() => ({}));
  const password = String(data.password || '');
  if (password.length < 12 || password.length > 128) {
    return json({ message: 'Password baru harus 12–128 karakter.' }, 400);
  }

  const target = await env.DB.prepare(
    'SELECT id, role FROM pm_admins WHERE id = ?'
  ).bind(id).first();
  if (!target) return json({ message: 'Akun admin tidak ditemukan.' }, 404);
  if (target.role === 'super_admin') {
    return json({ message: 'Reset password Super Admin tidak tersedia melalui endpoint ini.' }, 403);
  }

  const salt = await randomToken(16);
  const iterations = 310000;
  const hash = await passwordHash(password, salt, iterations);
  await env.DB.prepare(`
    UPDATE pm_admins
    SET password_hash = ?, password_salt = ?, password_iterations = ?,
        must_change_password = 1, updated_at = ?
    WHERE id = ?
  `).bind(hash, salt, iterations, now(), id).run();
  await env.DB.prepare(`
    UPDATE pm_admin_account_sessions SET revoked_at = ?
    WHERE admin_id = ? AND revoked_at IS NULL
  `).bind(now(), id).run();
  return json({ message: 'Password berhasil direset. Admin harus login kembali dan mengganti password.' });
}

async function adminChangeOwnPassword(request, env) {
  const account = await getAdminAccount(request, env);
  if (!account) return json({ message: 'Belum login dengan akun admin.' }, 401);
  const data = await request.json().catch(() => ({}));
  const currentPassword = String(data.current_password || '');
  const newPassword = String(data.new_password || '');
  if (newPassword.length < 12 || newPassword.length > 128) {
    return json({ message: 'Password baru harus 12–128 karakter.' }, 400);
  }

  const saved = await env.DB.prepare(`
    SELECT password_hash, password_salt, password_iterations
    FROM pm_admins WHERE id = ? AND is_active = 1
  `).bind(account.id).first();
  if (!saved || !currentPassword) {
    return json({ message: 'Password saat ini tidak cocok.' }, 401);
  }
  const candidate = await passwordHash(
    currentPassword,
    saved.password_salt,
    Number(saved.password_iterations || 310000)
  );
  if (candidate !== saved.password_hash) {
    return json({ message: 'Password saat ini tidak cocok.' }, 401);
  }

  const salt = await randomToken(16);
  const iterations = 310000;
  const hash = await passwordHash(newPassword, salt, iterations);
  await env.DB.prepare(`
    UPDATE pm_admins
    SET password_hash = ?, password_salt = ?, password_iterations = ?,
        must_change_password = 0, updated_at = ?
    WHERE id = ?
  `).bind(hash, salt, iterations, now(), account.id).run();

  await env.DB.prepare(`
    UPDATE pm_admin_account_sessions SET revoked_at = ?
    WHERE admin_id = ? AND revoked_at IS NULL
  `).bind(now(), account.id).run();

  const refreshed = await env.DB.prepare(`
    SELECT id, username, display_name, role, class_name, must_change_password
    FROM pm_admins WHERE id = ?
  `).bind(account.id).first();
  return createAdminAccountSession(env, refreshed);
}

async function serveFile(env, request, type, id) {
  if (type === 'submission') {
    return new Response('Pengumpulan file melalui ProMed Hub sudah dinonaktifkan. Gunakan platform resmi kampus.', { status: 410 });
  }

  if (type === 'material' && !(await canViewClassContent(env, request, 'material', id))) return new Response('Materi ini tidak tersedia untuk kelas yang dipilih.', { status: 404 });
  if (type === 'quiz' && !(await canViewClassContent(env, request, 'quiz', id))) return new Response('Kuis ini tidak tersedia untuk kelas yang dipilih.', { status: 404 });
  let row;
  if (type === 'material') {
    row = await env.DB.prepare("SELECT file_key,file_name,content_type,status FROM pm_materials WHERE id=? AND status='published'").bind(id).first();
  }
  if (type === 'quiz') {
    row = await env.DB.prepare("SELECT file_key,file_name,content_type,status FROM pm_quizzes WHERE id=? AND status='published'").bind(id).first();
  }
  if (!row) return new Response('File tidak ditemukan atau belum dipublikasikan.', { status: 404 });

  if (type === 'quiz') {
    const response = await githubRead(env, row.file_key);
    if (!response) return new Response('File kuis tidak ditemukan.', { status: 404 });
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': row.content_type || 'text/html; charset=UTF-8',
        'Content-Disposition': `inline; filename="${safeName(row.file_name)}"`,
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  const response = await githubRead(env, row.file_key);
  if (!response) return new Response('File materi tidak ditemukan.', { status: 404 });
  return new Response(response.body, {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeName(row.file_name)}"`,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);const p=url.pathname;
    try {
      if (
  request.method === 'GET' &&
  p.startsWith('/api/materials/') &&
  p.endsWith('/file')
) {
  const parts = p.split('/');
  const id = Number(parts[3]);

  if (!Number.isInteger(id) || id <= 0) {
    return json({ message: 'ID materi tidak valid.' }, 400);
  }

  return openMaterialFile(request, env, id);
}
      if(p==='/api/health')return json({ok:true,service:'ProMed Hub Staging'});
      if(request.method==='GET'&&p==='/api/classes')return json({items:PROMED_CLASSES.map(name=>({name,label:`Kelas ${name}`}))});
      if(request.method==='POST'&&p==='/api/login')return json({message:'Login mahasiswa sudah dinonaktifkan. Website dapat diakses langsung.'},410);
      if (request.method === 'GET' && p === '/api/admin/setup-status') return adminSetupStatus(env);
      if (request.method === 'POST' && p === '/api/admin/bootstrap') return bootstrapSuperAdmin(request, env);
      if (request.method === 'POST' && p === '/api/admin/login') return loginAdmin(request, env);
      if (request.method === 'POST' && p === '/api/logout') return json({ message: 'Login mahasiswa sudah tidak digunakan.' }, 410);
      if (request.method === 'POST' && p === '/api/admin/logout') return logoutAdmin(env, request);
      if (request.method === 'GET' && p === '/api/me') {
        const account = await getAdminAccount(request, env);
        if (account) {
          return json({
            authenticated: true,
            role: 'admin',
            admin: {
              id: account.id,
              username: account.username,
              display_name: account.display_name,
              admin_role: account.role,
              class_name: account.class_name || null,
              must_change_password: Number(account.must_change_password || 0)
            }
          });
        }
        if (await isAdmin(request, env)) {
          return json({ authenticated: true, role: 'admin', admin: null });
        }
        return json({ authenticated: false, role: 'public' }, 200);
      }

      if (p.startsWith('/api/admin/')) {
        const authorizationResponse = await authorizeAdminRequest(request, env, p);
        if (authorizationResponse) return authorizationResponse;
      }

      if (request.method === 'POST' && p === '/api/admin/change-password') {
        return adminChangeOwnPassword(request, env);
      }
      if (request.method === 'GET' && p === '/api/admin/accounts') {
        return adminListAccounts(request, env);
      }
      if (request.method === 'POST' && p === '/api/admin/accounts') {
        return adminCreateClassAccount(request, env);
      }
      if (request.method === 'PATCH' && /^\/api\/admin\/accounts\/\d+\/active$/.test(p)) {
        return adminSetAccountActive(request, env, Number(p.split('/')[4]));
      }
      if (request.method === 'POST' && /^\/api\/admin\/accounts\/\d+\/reset-password$/.test(p)) {
        return adminResetAccountPassword(request, env, Number(p.split('/')[4]));
      }
            if(request.method==='GET'&&p==='/api/profile/photo')return json({message:'Profil mahasiswa sudah tidak digunakan.'},410);

      if(request.method==='POST'&&p==='/api/profile/photo')return json({message:'Profil mahasiswa sudah tidak digunakan.'},410);
      if(request.method==='GET'&&p==='/api/profile')return json({message:'Profil mahasiswa sudah tidak digunakan.'},410);

if(request.method==='PUT'&&p==='/api/profile')return json({message:'Profil mahasiswa sudah tidak digunakan.'},410);
      if(request.method==='GET'&&p==='/api/materials')return listMaterials(env,request);
      if(request.method==='GET'&&p==='/api/quizzes')return listQuizzes(env,request);
      if(request.method==='GET'&&p==='/api/assignments')return listAssignments(env,request);
      if(request.method==='GET'&&/^\/api\/assignments\/\d+\/file$/.test(p))return openAssignmentFile(request,env,Number(p.split('/')[3]));
      if(request.method==='GET'&&p==='/api/templates')return listTemplates(env,request);
      if(request.method==='GET'&&p==='/api/courses')return listCourses(env,request);
      if(request.method==='GET'&&p==='/api/submissions')return json({message:'Riwayat unggah tugas melalui ProMed Hub sudah dinonaktifkan.'},410);
      if(request.method==='POST'&&p==='/api/submissions')return json({message:'Pengumpulan file dilakukan melalui platform resmi kampus, bukan ProMed Hub.'},410);
      if(request.method==='GET'&&p.startsWith('/api/files/material/'))return serveFile(env,request,'material',Number(p.split('/').pop()));
      if(request.method==='GET'&&p.startsWith('/api/files/quiz/'))return serveFile(env,request,'quiz',Number(p.split('/').pop()));
      if(request.method==='GET'&&p.startsWith('/api/files/submission/'))return serveFile(env,request,'submission',Number(p.split('/').pop()));
      if(request.method==='GET'&&p==='/api/admin/summary')return getAdminSummary(env,request);
      if(request.method==='GET'&&p==='/api/admin/students')return json({message:'Pengelolaan akun mahasiswa sudah tidak digunakan.'},410);
      if(request.method==='POST'&&p==='/api/admin/students')return json({message:'Admin tidak perlu menambahkan akun mahasiswa.'},410);
      if (request.method === 'GET' && p === '/api/admin/courses') {
  return listAdminCourses(env, request);
}

if (request.method === 'POST' && p === '/api/admin/courses') {
  return adminCreateCourse(request, env);
}

if (
  request.method === 'PUT' &&
  /^\/api\/admin\/courses\/\d+$/.test(p)
) {
  return adminUpdateCourse(
    request,
    env,
    Number(p.split('/').pop())
  );
}
      if(request.method==='POST'&&/^\/api\/admin\/students\/\d+\/reset-device$/.test(p))return json({message:'Pengelolaan device mahasiswa sudah tidak digunakan.'},410);
      if (
  request.method === 'PATCH' &&
  /^\/api\/admin\/courses\/\d+\/status$/.test(p)
) {
  return adminSetCourseStatus(
    request,
    env,
    Number(p.split('/')[4])
  );
}
      // API Pengumuman untuk mahasiswa
if (
  request.method === 'GET' &&
  p === '/api/announcements'
) {
  return listAnnouncements(env, request);
}

// API pengelolaan Pengumuman untuk admin
if (
  request.method === 'GET' &&
  p === '/api/admin/announcements'
) {
  return adminListAnnouncements(env, request);
}

if (
  request.method === 'POST' &&
  p === '/api/admin/announcements'
) {
  return adminCreateAnnouncement(request, env);
}

if (
  request.method === 'PUT' &&
  /^\/api\/admin\/announcements\/\d+$/.test(p)
) {
  return adminUpdateAnnouncement(
    request,
    env,
    Number(p.split('/').pop())
  );
}

if (
  request.method === 'PATCH' &&
  /^\/api\/admin\/announcements\/\d+\/status$/.test(p)
) {
  return adminSetAnnouncementStatus(
    request,
    env,
    Number(p.split('/')[4])
  );
}

if (
  request.method === 'DELETE' &&
  /^\/api\/admin\/announcements\/\d+$/.test(p)
) {
  return adminDeleteAnnouncement(
    request,
    env,
    Number(p.split('/').pop())
  );
}
      if(request.method==='POST'&&p==='/api/admin/materials')return adminCreateMaterial(request,env);
      if(request.method==='POST'&&p==='/api/admin/quizzes')return adminCreateQuiz(request,env);
      if(request.method==='POST'&&p==='/api/admin/assignments')return adminCreateAssignment(request,env);
      if(request.method==='DELETE'&&/^\/api\/admin\/materials\/\d+$/.test(p))return adminDeleteMaterial(request,env,Number(p.split('/').pop()));
      if(request.method==='DELETE'&&/^\/api\/admin\/quizzes\/\d+$/.test(p))return adminDeleteQuiz(request,env,Number(p.split('/').pop()));
      if(request.method==='POST'&&p==='/api/admin/templates')return adminCreateTemplate(request,env);
      if(request.method==='DELETE'&&/^\/api\/admin\/templates\/\d+$/.test(p))return await adminDeleteTemplate(request,env,Number(p.split('/').pop()));
      if(request.method==='DELETE'&&/^\/api\/admin\/assignments\/\d+$/.test(p))return adminDeleteAssignment(request,env,Number(p.split('/').pop()));
      if(request.method==='GET'&&p==='/api/admin/settings'){
        if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
        return getAdminSummary(env,request);
      }
      if(request.method==='POST'&&p==='/api/admin/settings')return json({message:'Pengaturan device mahasiswa sudah tidak digunakan.'},410);
      if(request.method==='GET'&&p==='/api/admin/submissions')return json({message:'Daftar pengumpulan file melalui ProMed Hub sudah dinonaktifkan.'},410);
if (
  request.method === 'GET' &&
  /^\/api\/materials\/\d+\/file$/.test(p)
) {
  return openMaterialFile(
    request,
    env,
    Number(p.split('/')[3])
  );
}
 if (
  request.method === 'GET' &&
  /^\/api\/templates\/\d+\/file$/.test(p)
) {
  return openTemplateFile(
    request,
    env,
    Number(p.split('/')[3])
  );
} 
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({message:'Terjadi kesalahan pada server.',detail:env.ENVIRONMENT==='development'?String(err):undefined},500);
    }
  }
};
