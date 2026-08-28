PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tournaments (
  league_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('premium', 'professional', 'excluded', 'amateur', 'unknown')),
  first_seen_at TEXT,
  last_seen_at TEXT,
  region TEXT NOT NULL CHECK (region = 'unknown'),
  source TEXT NOT NULL CHECK (source IN ('opendota_match', 'opendota_league', 'opendota_position_est')),
  fetched_at TEXT NOT NULL,
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'exploratory', 'none'))
);

CREATE TABLE IF NOT EXISTS pro_drafts (
  match_id TEXT PRIMARY KEY,
  league_id INTEGER NOT NULL,
  patch TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  game_mode INTEGER NOT NULL,
  radiant_team_id INTEGER,
  dire_team_id INTEGER,
  winning_side TEXT NOT NULL CHECK (winning_side IN ('radiant', 'dire')),
  source TEXT NOT NULL CHECK (source IN ('opendota_match', 'opendota_league', 'opendota_position_est')),
  fetched_at TEXT NOT NULL,
  sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
  ingest_status TEXT NOT NULL DEFAULT 'complete' CHECK (ingest_status IN ('complete', 'unclassifiable')),
  ingest_reason TEXT,
  raw_json TEXT NOT NULL,
  has_gcdata INTEGER NOT NULL DEFAULT 0 CHECK (has_gcdata IN (0, 1)),
  has_parsed INTEGER NOT NULL DEFAULT 0 CHECK (has_parsed IN (0, 1)),
  FOREIGN KEY (league_id) REFERENCES tournaments(league_id)
);

CREATE TABLE IF NOT EXISTS pro_draft_turns (
  match_id TEXT NOT NULL,
  draft_order INTEGER NOT NULL CHECK (draft_order BETWEEN 0 AND 23),
  is_pick INTEGER NOT NULL CHECK (is_pick IN (0, 1)),
  hero_id INTEGER NOT NULL,
  team INTEGER NOT NULL CHECK (team IN (0, 1)),
  PRIMARY KEY (match_id, draft_order),
  FOREIGN KEY (match_id) REFERENCES pro_drafts(match_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pro_draft_slots (
  match_id TEXT NOT NULL,
  hero_id INTEGER NOT NULL,
  team INTEGER NOT NULL CHECK (team IN (0, 1)),
  position_est INTEGER NOT NULL CHECK (position_est BETWEEN 1 AND 5),
  lane_role INTEGER NOT NULL,
  is_roaming INTEGER NOT NULL CHECK (is_roaming IN (0, 1)),
  net_worth INTEGER NOT NULL,
  -- PK por héroe (único por partida), no por (team, position_est): OpenDota entrega
  -- position_est duplicado o nulo en ~0.5% de los drafts y esa colisión descartaba filas.
  PRIMARY KEY (match_id, team, hero_id),
  FOREIGN KEY (match_id) REFERENCES pro_drafts(match_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingest_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT,
  updated_at TEXT NOT NULL
);
