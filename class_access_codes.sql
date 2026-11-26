
-- Kode akses kelas yang dikelola oleh Super Admin.
CREATE TABLE IF NOT EXISTS pm_class_access_codes (
  class_name TEXT PRIMARY KEY CHECK (
    class_name IN ('26 A', '26 B', '25 A', '25 B')
  ),
  code_hash TEXT NOT NULL UNIQUE,
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER,
  updated_by INTEGER,
  CHECK (
    starts_at IS NULL
    OR expires_at IS NULL
    OR expires_at > starts_at
  ),
  FOREIGN KEY (created_by) REFERENCES pm_admins(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES pm_admins(id) ON DELETE SET NULL
);

-- Sesi akses mahasiswa setelah kode kelas berhasil diverifikasi.
-- Token sesi disimpan dalam bentuk hash, bukan token asli.
CREATE TABLE IF NOT EXISTS pm_class_access_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL CHECK (
    class_name IN ('26 A', '26 B', '25 A', '25 B')
  ),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pm_class_access_sessions_class
ON pm_class_access_sessions(class_name);

CREATE INDEX IF NOT EXISTS idx_pm_class_access_sessions_active
ON pm_class_access_sessions(revoked_at, expires_at);

-- Pembatasan percobaan kode yang salah.
-- Alamat IP tidak disimpan langsung; hanya hash-nya.
CREATE TABLE IF NOT EXISTS pm_class_access_attempts (
  ip_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);
