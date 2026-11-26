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

CREATE TABLE IF NOT EXISTS pm_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  lecturer TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
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
  status TEXT NOT NULL DEFAULT 'published',
  course_id INTEGER
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
  status TEXT NOT NULL DEFAULT 'published',
  course_id INTEGER
);

CREATE TABLE IF NOT EXISTS pm_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  instructions TEXT,
  deadline TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  course_id INTEGER
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

CREATE TABLE IF NOT EXISTS pm_profiles (
  student_id INTEGER PRIMARY KEY,
  program_study TEXT NOT NULL DEFAULT '',
  cohort_year TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES pm_students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pm_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_key TEXT,
  file_name TEXT,
  content_type TEXT,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE TABLE IF NOT EXISTS pm_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'informasi',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_class_content (
  content_type TEXT NOT NULL CHECK (
    content_type IN ('course','material','quiz','assignment','template','announcement')
  ),
  content_id INTEGER NOT NULL,
  class_name TEXT NOT NULL CHECK (class_name IN ('26 A','26 B','25 A','25 B')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_type, content_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_class_content_class
ON pm_class_content(class_name, content_type);
CREATE INDEX IF NOT EXISTS idx_pm_class_content_item
ON pm_class_content(content_type, content_id);

CREATE TABLE IF NOT EXISTS pm_assignment_files (
  assignment_id INTEGER PRIMARY KEY,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id) REFERENCES pm_assignments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pm_assignment_files_uploaded
ON pm_assignment_files(uploaded_at);
