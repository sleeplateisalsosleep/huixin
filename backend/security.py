"""蕙心网后端 · 密码散列与会话管理"""
import hashlib
import hmac
import os
import re
import secrets

from .db import get_db, now_iso

ITERATIONS = 120_000
NAME_RE = re.compile(r'^[一-龥A-Za-z0-9_]{2,16}$')
EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')


def hash_password(pwd: str) -> str:
    salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac('sha256', pwd.encode('utf-8'),
                                 bytes.fromhex(salt), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'


def verify_password(pwd: str, stored: str) -> bool:
    try:
        _alg, iters, salt, digest = stored.split('$')
        calc = hashlib.pbkdf2_hmac('sha256', pwd.encode('utf-8'),
                                   bytes.fromhex(salt), int(iters)).hex()
        return hmac.compare_digest(calc, digest)
    except (ValueError, AttributeError):
        return False


def valid_name(name: str) -> bool:
    return bool(NAME_RE.match(name or ''))


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match((email or '').strip()))


def gen_code(length: int = 6) -> str:
    """生成纯数字验证码。"""
    return ''.join(str(secrets.randbelow(10)) for _ in range(length))


def create_session(user_id: int) -> str:
    token = secrets.token_hex(24)
    db = get_db()
    db.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)",
               (token, user_id, now_iso()))
    db.commit()
    return token


def destroy_session(token: str):
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    db.commit()


def session_user(token: str):
    if not token:
        return None
    db = get_db()
    row = db.execute(
        """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ?""", (token,)).fetchone()
    return row
