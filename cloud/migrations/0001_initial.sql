CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_command INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS users_due ON users(active, due);
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  done INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_done ON updates(done);
CREATE TABLE IF NOT EXISTS messages (
  user_id TEXT NOT NULL,
  id INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX IF NOT EXISTS messages_sent ON messages(sent);
CREATE TABLE IF NOT EXISTS outbox (
  user_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(user_id,event)
);
CREATE INDEX IF NOT EXISTS outbox_created ON outbox(created);
