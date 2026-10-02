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
const GITHUB_OWNER = 'gabrieljosanwidani-source';
const GITHUB_REPO = 'promed-files';
const GITHUB_BRANCH = 'main';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
  const getResponse = await fetch(githubUrl(path), {
    headers: githubHeaders(env)
  });

  if (!getResponse.ok) {
    if (getResponse.status === 404) return;
    throw new Error('File GitHub tidak ditemukan.');
  }

  const info = await getResponse.json();

  const response = await fetch(githubUrl(path), {
    method: 'DELETE',
    headers: {
      ...githubHeaders(env),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Delete ${path}`,
      sha: info.sha,
      branch: GITHUB_BRANCH
    })
  });

  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.message || `GitHub delete gagal (${response.status})`
    );
  }
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
async function isAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';

  let token = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : cookieValue(request, COOKIE.admin);

  if (!token) return false;

  const hash = await sha256(token);

  const row = await env.DB
    .prepare('SELECT expires_at FROM pm_admin_sessions WHERE token_hash=?')
    .bind(hash)
    .first();

  return !!row && new Date(row.expires_at).getTime() > Date.now();
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

async function loginAdmin(request, env) {
  const data = await request.json().catch(() => ({}));
  if (!env.ADMIN_KEY || String(data.key || '') !== env.ADMIN_KEY) return json({message:'Admin key salah.'}, 401);
  const token = await randomToken(32);
  const hash = await sha256(token);
  const expires = new Date(Date.now() + maxAgeDays(1)).toISOString();
  await env.DB.prepare('INSERT INTO pm_admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)').bind(hash, now(), expires).run();
  return json(
  {message:'Login admin berhasil.', admin_token: token},
  200,
  {'Set-Cookie': cookieHeader(COOKIE.admin, token, maxAgeDays(1))}
);
}

async function logoutStudent(env, request) {
  const token = cookieValue(request, COOKIE.session);
  if (token) await env.DB.prepare('DELETE FROM pm_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  const headers = new Headers({ 'content-type':'application/json; charset=UTF-8' });
  headers.append('Set-Cookie', clearCookieHeader(COOKIE.session));
  return json({message:'Logout berhasil.'}, 200, Object.fromEntries(headers));
}
async function logoutAdmin(env, request) {
  const token = cookieValue(request, COOKIE.admin);
  if (token) await env.DB.prepare('DELETE FROM pm_admin_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return json({message:'Logout admin berhasil.'}, 200, {'Set-Cookie': clearCookieHeader(COOKIE.admin)});
}

function userPayload(user) {
  return {id:user.id,npm:user.npm,name:user.name};
}
async function openMaterialFile(request, env, id) {
  const student = await currentStudent(request, env);
  const admin = await isAdmin(request, env);

  if (!student && !admin) {
    return json({ message: 'Belum login.' }, 401);
  }

  const row = await env.DB
    .prepare(
      'SELECT file_key,file_name,content_type FROM pm_materials WHERE id=? AND status=?'
    )
    .bind(id, 'published')
    .first();

  if (!row) {
    return json({ message: 'Materi tidak ditemukan.' }, 404);
  }

  const response = await githubRead(env, row.file_key);

  if (!response) {
    return json({ message: 'File materi tidak ditemukan.' }, 404);
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
async function listMaterials(env, request) {
  const user = await currentStudent(request, env);
  if (!user && !(await isAdmin(request, env))) return json({message:'Belum login.'}, 401);
  const q = await env.DB.prepare(`SELECT id,title,course,course_id,meeting,source_url,file_key,file_name,content_type,uploaded_at,status
FROM pm_materials WHERE status='published' ORDER BY uploaded_at DESC`).all();
  return json({items:q.results || []});
}
async function listQuizzes(env, request) {
  const user = await currentStudent(request, env);
  if (!user && !(await isAdmin(request, env))) return json({message:'Belum login.'}, 401);
  const q = await env.DB.prepare(`SELECT id,title,course,course_id,meeting,file_name,content_type,uploaded_at,status FROM pm_quizzes WHERE status='published' ORDER BY uploaded_at DESC`).all();
  return json({items:q.results || []});
}
async function listAssignments(env, request) {
  const user = await currentStudent(request, env);
  if (!user && !(await isAdmin(request, env))) return json({message:'Belum login.'}, 401);
  const q = await env.DB.prepare(`SELECT id,title,course,course_id,instructions,deadline,created_at,status FROM pm_assignments WHERE status='active' ORDER BY CASE WHEN deadline IS NULL OR deadline='' THEN 1 ELSE 0 END, deadline`).all();
  return json({items:q.results || []});
}
async function listCourses(env, request) {
  const user = await currentStudent(request, env);
  const admin = await isAdmin(request, env);

  if (!user && !admin) {
    return json({ message: 'Belum login.' }, 401);
  }

  const q = await env.DB.prepare(`
    SELECT id, name, semester, lecturer, description, status
    FROM pm_courses
    WHERE status = 'active'
    ORDER BY semester ASC, name ASC
  `).all();

  return json({
    items: q.results || []
  });
}
async function adminUploadFile(request, env, kind) {
  if (!(await isAdmin(request, env))) return json({message:'Belum login admin.'}, 401);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({message:'File belum dipilih.'}, 400);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 25 * 1024 * 1024) return json({message:'File terlalu besar untuk prototipe ini (maks 25 MB).'}, 413);
  const title = String(form.get('title') || '').trim();
  const course = String(form.get('course') || '').trim();
  const meeting = String(form.get('meeting') || '').trim();
  const sourceUrl = String(form.get('source_url') || '').trim();
  if (!title || !course) return json({message:'Judul dan mata kuliah wajib diisi.'}, 400);
  const id = crypto.randomUUID();
  const filename = extName(file.name);
  const key = `${kind}/${id}-${filename}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: guessType(file) } });
  if (kind === 'material') {
    await env.DB.prepare(`INSERT INTO pm_materials(id,title,course,meeting,source_url,file_key,file_name,content_type,uploaded_at,status) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(idToInt(id),title,course,meeting,sourceUrl,key,file.name,guessType(file),now(),'published').run();
  }
  if (kind === 'quiz') {
    await env.DB.prepare(`INSERT INTO pm_quizzes(id,title,course,meeting,file_key,file_name,content_type,uploaded_at,status) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(idToInt(id),title,course,meeting,key,file.name,guessType(file),now(),'published').run();
  }
  return json({message:'Berhasil dipublikasikan.',id, file_name:file.name});
}

function idToInt(uuid) {
  // D1 integer PKs are generated by the database. This value is only used as a stable-ish API response;
  // the insert functions below intentionally do not require UUID PKs in the database.
  return undefined;
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

  return json({
    message: 'Materi berhasil dipublikasikan untuk seluruh mahasiswa.',
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

  return json({
    message: 'Kuis berhasil dipublikasikan untuk seluruh mahasiswa.',
    id: result.meta.last_row_id,
    file_key: key
  });
}

async function adminCreateAssignment(request, env) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  const data=await request.json().catch(()=>({}));
  const title=String(data.title||'').trim(),course=String(data.course||'').trim(),instructions=String(data.instructions||'').trim(),deadline=String(data.deadline||'').trim();
  if(!title||!course)return json({message:'Judul dan mata kuliah wajib diisi.'},400);
  const r=await env.DB.prepare(`INSERT INTO pm_assignments(title,course,instructions,deadline,created_at,status) VALUES(?,?,?,?,?,?)`).bind(title,course,instructions,deadline,now(),'active').run();
  return json({message:'Tugas dibuat untuk seluruh mahasiswa.',id:r.meta.last_row_id});
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

  await env.DB
    .prepare('DELETE FROM pm_materials WHERE id=?')
    .bind(id)
    .run();

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

  await env.DB
    .prepare('DELETE FROM pm_quizzes WHERE id=?')
    .bind(id)
    .run();

  return json({ message: 'Kuis dihapus.' });
}
async function adminDeleteAssignment(request, env, id) {
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  await env.DB.prepare('DELETE FROM pm_assignments WHERE id=?').bind(id).run();return json({message:'Tugas dihapus.'});
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
  if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
  const maxDevices=Number(await getSetting(env,'max_devices',45));
  const perStudent=Number(await getSetting(env,'max_devices_per_student',1));
  const [d,m,q,a,s] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS c FROM pm_devices WHERE active=1').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM pm_materials').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM pm_quizzes').first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM pm_assignments WHERE status='active'").first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM pm_submissions').first()
  ]);
  return json({max_devices:maxDevices,max_devices_per_student:perStudent,device_used:Number(d?.c||0),materials:Number(m?.c||0),quizzes:Number(q?.c||0),assignments:Number(a?.c||0),submissions:Number(s?.c||0)});
}

async function listSubmissions(env, request) {
  const admin=await isAdmin(request,env);const student=await currentStudent(request,env);
  if(!admin&&!student)return json({message:'Belum login.'},401);
  if(admin){
    const q=await env.DB.prepare(`SELECT ps.id,ps.title,ps.file_name,ps.uploaded_at,pa.title AS assignment,st.npm,st.name,st.id AS student_id FROM pm_submissions ps JOIN pm_assignments pa ON pa.id=ps.assignment_id JOIN pm_students st ON st.id=ps.student_id ORDER BY ps.uploaded_at DESC`).all();
    return json({items:q.results||[],role:'admin'});
  }
  const q=await env.DB.prepare(`SELECT ps.id,ps.title,ps.file_name,ps.uploaded_at,pa.title AS assignment FROM pm_submissions ps JOIN pm_assignments pa ON pa.id=ps.assignment_id WHERE ps.student_id=? ORDER BY ps.uploaded_at DESC`).bind(student.id).all();
  return json({items:q.results||[],role:'student'});
}
async function submitWork(env,request) {
  const student=await currentStudent(request,env);if(!student)return json({message:'Belum login mahasiswa.'},401);
  const form=await request.formData();const assignmentId=Number(form.get('assignment_id'));const title=String(form.get('title')||'').trim();const file=form.get('file');
  if(!assignmentId||!(file instanceof File))return json({message:'Tugas dan file wajib diisi.'},400);
  const assignment=await env.DB.prepare("SELECT id,title FROM pm_assignments WHERE id=? AND status='active'").bind(assignmentId).first();if(!assignment)return json({message:'Tugas tidak ditemukan.'},404);
  if(Number(request.headers.get('content-length')||0)>25*1024*1024)return json({message:'File terlalu besar (maks 25 MB).'},413);
  const key=`submissions/${student.id}/${crypto.randomUUID()}-${extName(file.name)}`;
  await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:guessType(file)}});
  const r=await env.DB.prepare(`INSERT INTO pm_submissions(assignment_id,student_id,title,file_key,file_name,content_type,uploaded_at) VALUES(?,?,?,?,?,?,?)`).bind(assignmentId,student.id,title||file.name,key,file.name,guessType(file),now()).run();
  return json({message:'Karya berhasil dikumpulkan.',id:r.meta.last_row_id});
}

async function serveFile(env, request, type, id) {
  const admin=await isAdmin(request,env);const student=await currentStudent(request,env);if(!admin&&!student)return new Response('Unauthorized',{status:401});
  let row;
  if(type==='material') row=await env.DB.prepare('SELECT file_key,file_name,content_type FROM pm_materials WHERE id=?').bind(id).first();
  if(type==='quiz') row=await env.DB.prepare('SELECT file_key,file_name,content_type FROM pm_quizzes WHERE id=?').bind(id).first();
  if(type==='submission') row=await env.DB.prepare('SELECT file_key,file_name,content_type,student_id FROM pm_submissions WHERE id=?').bind(id).first();
  if(!row)return new Response('Not Found',{status:404});
  if(type==='submission'&&!admin&&row.student_id!==student.id)return new Response('Forbidden',{status:403});

  if (type === 'quiz') {
  const response = await githubRead(env, row.file_key);

  if (!response) {
    return new Response('File Not Found', { status: 404 });
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    row.content_type || 'text/html; charset=UTF-8'
  );
  headers.set(
    'Content-Disposition',
    `inline; filename="${safeName(row.file_name)}"`
  );
  headers.set('Cache-Control', 'private, no-store');

  return new Response(response.body, { headers });
}
  const object=await env.FILES.get(row.file_key);if(!object)return new Response('File Not Found',{status:404});
  const headers=new Headers();headers.set('Content-Type',row.content_type||'application/octet-stream');headers.set('Content-Disposition',`inline; filename="${safeName(row.file_name)}"`);headers.set('Cache-Control','private, max-age=300');
  return new Response(object.body,{headers});
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
      if(p==='/api/health')return json({ok:true,service:'ProMed Hub'});
      if(request.method==='POST'&&p==='/api/login')return loginStudent(request,env);
      if(request.method==='POST'&&p==='/api/admin/login')return loginAdmin(request,env);
      if(request.method==='POST'&&p==='/api/logout')return logoutStudent(env,request);
      if(request.method==='POST'&&p==='/api/admin/logout')return logoutAdmin(env,request);
      if(request.method==='GET'&&p==='/api/me'){
        if(await isAdmin(request,env))return json({authenticated:true,role:'admin'});
        const s=await currentStudent(request,env);if(s)return json({authenticated:true,role:'student',user:userPayload(s)});
        return json({authenticated:false},200);
      }
      if(request.method==='GET'&&p==='/api/materials')return listMaterials(env,request);
      if(request.method==='GET'&&p==='/api/quizzes')return listQuizzes(env,request);
      if(request.method==='GET'&&p==='/api/assignments')return listAssignments(env,request);
      if(request.method==='GET'&&p==='/api/courses')return listCourses(env,request);
      if(request.method==='GET'&&p==='/api/submissions')return listSubmissions(env,request);
      if(request.method==='POST'&&p==='/api/submissions')return submitWork(env,request);
      if(request.method==='GET'&&p.startsWith('/api/files/material/'))return serveFile(env,request,'material',Number(p.split('/').pop()));
      if(request.method==='GET'&&p.startsWith('/api/files/quiz/'))return serveFile(env,request,'quiz',Number(p.split('/').pop()));
      if(request.method==='GET'&&p.startsWith('/api/files/submission/'))return serveFile(env,request,'submission',Number(p.split('/').pop()));
      if(request.method==='GET'&&p==='/api/admin/summary')return getAdminSummary(env,request);
      if(request.method==='GET'&&p==='/api/admin/students')return listStudents(env,request);
      if(request.method==='POST'&&p==='/api/admin/students')return addStudent(request,env);
      if(request.method==='POST'&&/^\/api\/admin\/students\/\d+\/reset-device$/.test(p))return resetStudentDevice(env,request,Number(p.split('/')[4]));
      if(request.method==='POST'&&p==='/api/admin/materials')return adminCreateMaterial(request,env);
      if(request.method==='POST'&&p==='/api/admin/quizzes')return adminCreateQuiz(request,env);
      if(request.method==='POST'&&p==='/api/admin/assignments')return adminCreateAssignment(request,env);
      if(request.method==='DELETE'&&/^\/api\/admin\/materials\/\d+$/.test(p))return adminDeleteMaterial(request,env,Number(p.split('/').pop()));
      if(request.method==='DELETE'&&/^\/api\/admin\/quizzes\/\d+$/.test(p))return adminDeleteQuiz(request,env,Number(p.split('/').pop()));
      if(request.method==='DELETE'&&/^\/api\/admin\/assignments\/\d+$/.test(p))return adminDeleteAssignment(request,env,Number(p.split('/').pop()));
      if(request.method==='GET'&&p==='/api/admin/settings'){
        if(!(await isAdmin(request,env)))return json({message:'Belum login admin.'},401);
        return getAdminSummary(env,request);
      }
      if(request.method==='POST'&&p==='/api/admin/settings')return updateSettings(env,request);
      if(request.method==='GET'&&p==='/api/admin/submissions')return listSubmissions(env,request);
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
  
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({message:'Terjadi kesalahan pada server.',detail:env.ENVIRONMENT==='development'?String(err):undefined},500);
    }
  }
};
