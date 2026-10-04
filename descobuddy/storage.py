"""SQLite durable settings, encrypted financial evidence and notification outbox."""

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.fernet import Fernet


def utcnow():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        key_path = directory / "encryption.key"
        db_path = directory / "descobuddy.sqlite3"
        if not key_path.exists():
            if db_path.exists():
                raise ValueError(
                    "Encryption key missing. Restore data/encryption.key from backup; do not replace it."
                )
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(Fernet.generate_key())
        self.cipher = Fernet(key_path.read_bytes())
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute("PRAGMA secure_delete=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL, fetched TEXT NOT NULL,
            digest TEXT NOT NULL, payload BLOB NOT NULL, UNIQUE(kind, digest));
        CREATE TABLE IF NOT EXISTS outbox (
            event TEXT PRIMARY KEY, payload BLOB NOT NULL, created TEXT NOT NULL,
            sent TEXT, attempts INTEGER NOT NULL DEFAULT 0);
        """)
        self.db.commit()

    def close(self):
        self.db.close()

    def pack(self, value):
        return self.cipher.encrypt(json.dumps(value, ensure_ascii=False, sort_keys=True).encode())

    def unpack(self, value):
        return json.loads(self.cipher.decrypt(value))

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return self.unpack(row[0]) if row else default

    def set(self, key, value):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, self.pack(value)))

    def track_message(self, message):
        if not isinstance(message.message_id, int) or not isinstance(message.date, datetime):
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).timestamp()
        key = f"chat_messages:{message.chat_id}"
        records = {k: v for k, v in self.get(key, {}).items() if v > cutoff}
        if message.date.timestamp() > cutoff:
            records[str(message.message_id)] = message.date.timestamp()
        self.set(key, records)

    def evidence(self, kind, payload):
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO evidence(kind,fetched,digest,payload) VALUES(?,?,?,?)",
                (kind, utcnow(), digest, self.pack(payload)),
            )

    def records(self, kind=None, limit=20000):
        if kind:
            rows = self.db.execute(
                "SELECT * FROM evidence WHERE kind=? ORDER BY id DESC LIMIT ?", (kind, limit)
            )
        else:
            rows = self.db.execute("SELECT * FROM evidence ORDER BY id DESC LIMIT ?", (limit,))
        return [
            {"kind": r["kind"], "fetched": r["fetched"], "payload": self.unpack(r["payload"])} for r in rows
        ]

    def enqueue(self, event, message):
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO outbox(event,payload,created) VALUES(?,?,?)",
                (event, self.pack(message), utcnow()),
            )

    def pending(self):
        return [
            (r["event"], self.unpack(r["payload"]))
            for r in self.db.execute(
                "SELECT event,payload FROM outbox WHERE sent IS NULL ORDER BY created LIMIT 10"
            )
        ]

    def delivered(self, event):
        with self.db:
            self.db.execute("UPDATE outbox SET sent=? WHERE event=?", (utcnow(), event))

    def is_pending(self, event):
        return (
            self.db.execute("SELECT 1 FROM outbox WHERE event=? AND sent IS NULL", (event,)).fetchone()
            is not None
        )

    def clear_pending(self):
        with self.db:
            self.db.execute("DELETE FROM outbox WHERE sent IS NULL")

    def cancel_pending(self, prefix):
        with self.db:
            self.db.execute("DELETE FROM outbox WHERE sent IS NULL AND event LIKE ?", (prefix + "%",))

    def disconnect(self):
        with self.db:
            self.db.execute("DELETE FROM settings")
            self.db.execute("DELETE FROM evidence")
            self.db.execute("DELETE FROM outbox")
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        self.db.execute("VACUUM")
