-- Lampiran tugas yang diunggah oleh admin.
-- Upload jawaban mahasiswa tetap dinonaktifkan.

CREATE TABLE IF NOT EXISTS pm_assignment_files (
  assignment_id INTEGER PRIMARY KEY,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id)
    REFERENCES pm_assignments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_assignment_files_uploaded
ON pm_assignment_files(uploaded_at);
