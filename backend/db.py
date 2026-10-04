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
  email      TEXT UNIQUE,
  pwd_hash   TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  choice     TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL DEFAULT '',
  assess_at  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_lookup ON clicks(type, target);
CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_assess_user ON assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);
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


def init_db(admin_hash, admin_email='admin@huixin.local'):
    """建表、迁移旧表、播种管理员与内置科普卡。返回 (新建管理员?, 新建卡片数)。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)

    # 迁移：旧版 users 表没有 email 列、pwd_hash 为 NOT NULL
    cols = [r[1] for r in conn.execute('PRAGMA table_info(users)').fetchall()]
    if 'email' not in cols:
        conn.execute('ALTER TABLE users ADD COLUMN email TEXT')
    # 旧表 pwd_hash NOT NULL → 重建为可空（兼容无密码的邮箱用户）
    if 'pwd_hash' in cols:
        # 检查是否仍为 NOT NULL
        pwd_col = [r for r in conn.execute('PRAGMA table_info(users)').fetchall()
                   if r[1] == 'pwd_hash'][0]
        if pwd_col[3] == 1:  # notnull=1
            # SQLite 不支持修改列约束，重建表
            conn.executescript("""
                CREATE TABLE users_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  email TEXT UNIQUE,
                  pwd_hash TEXT,
                  role TEXT NOT NULL DEFAULT 'user',
                  created_at TEXT NOT NULL
                );
                INSERT INTO users_new (id, name, email, pwd_hash, role, created_at)
                  SELECT id, name, NULL, pwd_hash, role, created_at FROM users;
                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
            """)

    admin_created = False
    row = conn.execute("SELECT id, email FROM users WHERE name = 'admin'").fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO users (name, email, pwd_hash, role, created_at) VALUES (?,?,?,?,?)",
            ('admin', admin_email, admin_hash, 'admin', now_iso())
        )
        admin_created = True
    elif admin_email and admin_email != 'admin@huixin.local' and row['email'] != admin_email:
        # 配置了真实管理员邮箱则更新（占位邮箱或旧值都会被替换）
        conn.execute("UPDATE users SET email = ? WHERE name = 'admin'", (admin_email,))

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
        'id': row['id'], 'name': row['name'],
        'email': row['email'] if 'email' in row.keys() else None,
        'role': row['role'], 'created_at': row['created_at']
    }
