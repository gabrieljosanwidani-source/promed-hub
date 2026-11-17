-- Pembagian konten ProMed Hub berdasarkan kelas.
-- Konten lama tetap berlaku untuk semua kelas.

CREATE TABLE IF NOT EXISTS pm_class_content (
  content_type TEXT NOT NULL CHECK (
    content_type IN (
      'course',
      'material',
      'quiz',
      'assignment',
      'template',
      'announcement'
    )
  ),
  content_id INTEGER NOT NULL,
  class_name TEXT NOT NULL CHECK (
    class_name IN ('26 A', '26 B', '25 A', '25 B')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_class_content_class
ON pm_class_content(class_name, content_type);

CREATE INDEX IF NOT EXISTS idx_pm_class_content_item
ON pm_class_content(content_type, content_id);
