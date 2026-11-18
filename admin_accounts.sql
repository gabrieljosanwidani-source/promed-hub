-- ProMed Hub: Multi Admin Database
-- Struktur akun admin individual, sesi login, dan aktivitas admin.
-- Belum membuat akun atau mengubah login admin lama.

CREATE TABLE IF NOT EXISTS pm_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  role TEXT NOT NULL
    CHECK (role IN ('super_admin', 'class_admin')),
  class_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  created_by INTEGER,
  CHECK (
    (role = 'super_admin' AND class_name IS NULL)
    OR
    (role = 'class_admin' AND class_name IN (
      '26 A', '26 B', '25 A', '25 B'
    ))
  ),
  FOREIGN KEY (created_by)
    REFERENCES pm_admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pm_admins_role
ON pm_admins(role, is_active);

CREATE INDEX IF NOT EXISTS idx_pm_admins_class
ON pm_admins(class_name, is_active);

CREATE TABLE IF NOT EXISTS pm_admin_account_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (admin_id)
    REFERENCES pm_admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_admin_sessions_account
ON pm_admin_account_sessions(admin_id);

CREATE TABLE IF NOT EXISTS pm_admin_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  class_name TEXT,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_id)
    REFERENCES pm_admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pm_admin_activity_admin
ON pm_admin_activity(admin_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pm_admin_activity_created
ON pm_admin_activity(created_at);
