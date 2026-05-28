PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS ingest_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_registry_snapshot (
  source_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  allowed_mode TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  terms_url TEXT NOT NULL DEFAULT '',
  license_note TEXT NOT NULL DEFAULT '',
  rate_limit_rps REAL NOT NULL DEFAULT 0,
  stores_raw_prompts INTEGER NOT NULL DEFAULT 0,
  stores_images INTEGER NOT NULL DEFAULT 0,
  adult_policy TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT '',
  source_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'canceled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  cursor_before TEXT NOT NULL DEFAULT '',
  cursor_after TEXT NOT NULL DEFAULT '',
  fetched_count INTEGER NOT NULL DEFAULT 0,
  raw_record_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_id) REFERENCES source_registry_snapshot(source_id)
);

CREATE TABLE IF NOT EXISTS import_cursors (
  source_id TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES source_registry_snapshot(source_id)
);

CREATE TABLE IF NOT EXISTS raw_prompt_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  record_hash TEXT NOT NULL UNIQUE,
  positive_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  model_family TEXT,
  resources_json TEXT NOT NULL DEFAULT '[]',
  adult_level INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  source_created_at TEXT,
  raw_json TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK(parse_status IN ('pending', 'parsed', 'failed', 'skipped')),
  parse_error TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(source_id) REFERENCES source_registry_snapshot(source_id),
  UNIQUE(source_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS prompt_parse_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_record_id INTEGER NOT NULL,
  polarity TEXT NOT NULL CHECK(polarity IN ('positive', 'negative')),
  raw_token TEXT NOT NULL,
  canonical_candidate TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK(token_kind IN ('tag', 'phrase', 'negative', 'resource', 'artist', 'character', 'copyright', 'quality', 'meta', 'unknown')),
  weight REAL,
  prompt_position INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  parser_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(raw_record_id) REFERENCES raw_prompt_records(id) ON DELETE CASCADE,
  UNIQUE(raw_record_id, polarity, prompt_position, raw_token)
);

CREATE TABLE IF NOT EXISTS candidate_tags (
  candidate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_tag TEXT NOT NULL UNIQUE,
  display_tag TEXT NOT NULL,
  token_kind TEXT NOT NULL DEFAULT 'tag',
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  adult_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'needs-review', 'accepted', 'hidden', 'rejected', 'promoted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_evidence (
  evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  raw_record_id INTEGER,
  polarity TEXT NOT NULL CHECK(polarity IN ('positive', 'negative')),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  model_family TEXT,
  sample_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES candidate_tags(candidate_id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES source_registry_snapshot(source_id),
  FOREIGN KEY(raw_record_id) REFERENCES raw_prompt_records(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS translation_jobs (
  job_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  ja_label TEXT NOT NULL DEFAULT '',
  ja_meaning TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'needs-review' CHECK(status IN ('curated', 'source-derived', 'machine-draft', 'needs-review', 'rejected')),
  provider TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES candidate_tags(candidate_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meaning_lookup_cache (
  cache_id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_tag TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_key TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  lookup_status TEXT NOT NULL DEFAULT 'found' CHECK(lookup_status IN ('found', 'not-found', 'failed')),
  confidence REAL NOT NULL DEFAULT 0,
  summary_text TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  UNIQUE(canonical_tag, provider, provider_key)
);

CREATE TABLE IF NOT EXISTS meaning_enrichment_decisions (
  decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER,
  canonical_tag TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('apply', 'skip', 'preview-only', 'provider-error')),
  reason TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  selected_provider TEXT NOT NULL DEFAULT '',
  selected_evidence_kind TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ja_label TEXT NOT NULL DEFAULT '',
  ja_meaning TEXT NOT NULL DEFAULT '',
  applied INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  script_version TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES candidate_tags(candidate_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS promotion_decisions (
  candidate_id INTEGER PRIMARY KEY,
  decision TEXT NOT NULL CHECK(decision IN ('accept', 'hide', 'reject')),
  ja_label TEXT NOT NULL DEFAULT '',
  ja_meaning TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL,
  decided_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(candidate_id) REFERENCES candidate_tags(candidate_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_runs_source ON import_runs(source_id, started_at);
CREATE INDEX IF NOT EXISTS idx_raw_prompt_records_source ON raw_prompt_records(source_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_raw_prompt_records_parse_status ON raw_prompt_records(parse_status);
CREATE INDEX IF NOT EXISTS idx_prompt_parse_results_candidate ON prompt_parse_results(canonical_candidate, token_kind);
CREATE INDEX IF NOT EXISTS idx_candidate_tags_status ON candidate_tags(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_candidate_evidence_candidate ON candidate_evidence(candidate_id, source_id);
CREATE INDEX IF NOT EXISTS idx_meaning_lookup_cache_tag ON meaning_lookup_cache(canonical_tag, provider);
CREATE INDEX IF NOT EXISTS idx_meaning_enrichment_decisions_tag ON meaning_enrichment_decisions(canonical_tag, generated_at);

INSERT OR IGNORE INTO ingest_meta(key, value) VALUES ('schema_version', '1');
