-- USERS
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

-- PASSKEYS (WebAuthn credentials)
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,
  created_at INTEGER NOT NULL
);

-- SESSIONS (Lucia-managed)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- BIRTH DATA
CREATE TABLE birth_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  date_utc TEXT NOT NULL,
  date_local TEXT NOT NULL,
  timezone TEXT NOT NULL,
  place_name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  natal_chart_json TEXT,
  cached_at INTEGER
);

-- CONSTELLATIONS (groups)
CREATE TABLE constellations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id),
  invite_token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

-- MEMBERSHIPS
CREATE TABLE memberships (
  constellation_id TEXT NOT NULL REFERENCES constellations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (constellation_id, user_id)
);

-- JOURNAL ENTRIES
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  constellation_id TEXT REFERENCES constellations(id),
  body TEXT NOT NULL,
  written_at INTEGER NOT NULL,
  transit_snapshot_json TEXT
);

-- SYNASTRY REPORTS (cached)
CREATE TABLE synastry_reports (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL REFERENCES users(id),
  user_b_id TEXT NOT NULL REFERENCES users(id),
  aspects_json TEXT NOT NULL,
  narrative TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  UNIQUE(user_a_id, user_b_id)
);
