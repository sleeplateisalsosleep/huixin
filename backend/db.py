"""蕙心网后端 · SQLite 数据库层"""
import json
import os
import sqlite3
from datetime import datetime

from flask import g

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'huixin.db')
SEED_PATH = os.path.join(ROOT, 'backend', 'kb_seed.json')

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  pwd_hash   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT DEFAULT '',
  cat           TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  body          TEXT NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'builtin',
  author_id     INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'approved',
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT
);
CREATE TABLE IF NOT EXISTS clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  type       TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  client_at  TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, client_at)
);
CREATE INDEX IF NOT EXISTS idx_clicks_lookup ON clicks(type, target);
CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_assess_user ON assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
"""


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def get_db():
    if 'db' not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        g.db = conn
    return g.db


def close_db(_exc=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db(admin_hash):
    """建表、播种管理员与内置科普卡。返回 (新建管理员?, 新建卡片数)。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)

    admin_created = False
    row = conn.execute("SELECT id FROM users WHERE name = 'admin'").fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO users (name, pwd_hash, role, created_at) VALUES (?,?,?,?)",
            ('admin', admin_hash, 'admin', now_iso())
        )
        admin_created = True

    cards_added = 0
    if conn.execute('SELECT COUNT(*) AS n FROM cards').fetchone()['n'] == 0:
        with open(SEED_PATH, encoding='utf-8') as f:
            seeds = json.load(f)
        for k in seeds:
            conn.execute(
                """INSERT INTO cards (slug, cat, title, summary, tags, body,
                                      source, author_id, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (k['id'], k['cat'], k['title'], k.get('summary', ''),
                 json.dumps(k.get('tags', []), ensure_ascii=False),
                 json.dumps(k.get('body', []), ensure_ascii=False),
                 'builtin', None, 'approved', now_iso())
            )
            cards_added = len(seeds)

    conn.commit()
    conn.close()
    return admin_created, cards_added


# ---------------- 序列化辅助 ----------------
def card_public(row, *, with_body=False):
    d = {
        'id': row['id'],
        'slug': row['slug'] or '',
        'cat': row['cat'],
        'title': row['title'],
        'summary': row['summary'],
        'tags': json.loads(row['tags'] or '[]'),
        'source': row['source'],
        'status': row['status'],
        'created_at': row['created_at'],
    }
    if with_body:
        d['body'] = json.loads(row['body'] or '[]')
        if row['status'] != 'approved':
            d['reject_reason'] = row['reject_reason'] or ''
    return d


def user_public(row):
    return {
        'id': row['id'], 'name': row['name'], 'role': row['role'],
        'created_at': row['created_at']
    }
