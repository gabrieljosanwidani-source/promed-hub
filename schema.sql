-- ProMed Hub schema. Safe to run on the existing D1 database used by the quiz;
-- table names are prefixed with pm_ to avoid collisions with access_codes.

CREATE TABLE IF NOT EXISTS pm_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO pm_settings(key,value) VALUES ('max_devices','45');
INSERT OR IGNORE INTO pm_settings(key,value) VALUES ('max_devices_per_student','1');

CREATE TABLE IF NOT EXISTS pm_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npm TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  dob_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  device_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(student_id, device_hash),
  FOREIGN KEY(student_id) REFERENCES pm_students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pm_devices_active ON pm_devices(active);

CREATE TABLE IF NOT EXISTS pm_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(student_id) REFERENCES pm_students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pm_sessions_token ON pm_sessions(token_hash);

CREATE TABLE IF NOT EXISTS pm_admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  meeting TEXT,
  source_url TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_pm_materials_course ON pm_materials(course);
CREATE INDEX IF NOT EXISTS idx_pm_materials_uploaded ON pm_materials(uploaded_at);

CREATE TABLE IF NOT EXISTS pm_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  meeting TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE TABLE IF NOT EXISTS pm_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  instructions TEXT,
  deadline TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS pm_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY(assignment_id) REFERENCES pm_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES pm_students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pm_submissions_student ON pm_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_pm_submissions_assignment ON pm_submissions(assignment_id);
