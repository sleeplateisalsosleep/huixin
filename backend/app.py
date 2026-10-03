"""蕙心网后端 · Flask 应用工厂
功能：
- 用户账户（注册 / 登录 / 会话令牌 / 管理员）
- 核心功能二科普卡内容管理与投稿审核
- 点击量数据统计
- 自评数据云端同步
- 同端口托管前端静态文件（免跨域）
"""
import json
import os

from flask import Flask, abort, jsonify, request, send_from_directory

from . import db as dbmod
from .db import (ROOT, card_public, close_db, get_db, init_db, now_iso,
                 user_public)
from .security import (create_session, destroy_session, hash_password,
                       session_user, valid_name, verify_password)

ADMIN_DEFAULT_PWD = 'Huixin@2026'


def create_app():
    app = Flask(__name__)
    app.teardown_appcontext(close_db)

    admin_created, cards_added = init_db(hash_password(ADMIN_DEFAULT_PWD))
    if admin_created:
        print('[蕙心网] 已生成管理员账号  admin / %s' % ADMIN_DEFAULT_PWD)
    if cards_added:
        print('[蕙心网] 已导入内置科普卡片 %d 条' % cards_added)

    # ---------------- 基础工具 ----------------
    def err(msg, code=400):
        return jsonify({'error': msg}), code

    def get_token():
        t = request.headers.get('X-Auth-Token', '')
        if not t:
            auth = request.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                t = auth[7:]
        return t

    def current():
        return session_user(get_token())

    def require_user():
        u = current()
        if u is None:
            abort(401)
        return u

    def require_admin():
        u = current()
        if u is None:
            abort(401)
        if u['role'] != 'admin':
            abort(403)
        return u

    @app.errorhandler(400)
    def _400(e):
        return jsonify({'error': getattr(e, 'description', '请求参数有误')}), 400

    @app.errorhandler(401)
    def _401(e):
        return jsonify({'error': '请先登录后再进行该操作'}), 401

    @app.errorhandler(403)
    def _403(e):
        return jsonify({'error': '权限不足，仅管理员可操作'}), 403

    @app.errorhandler(404)
    def _404(e):
        return jsonify({'error': '资源不存在'}), 404

    def validate_card_payload(p, *, partial=False):
        """校验科普卡字段，返回清洗后的 dict。"""
        out = {}
        if not partial or 'cat' in p:
            cat = str(p.get('cat', '')).strip()
            if not (1 <= len(cat) <= 10):
                return None, '分类需为 1～10 个字'
            out['cat'] = cat
        if not partial or 'title' in p:
            title = str(p.get('title', '')).strip()
            if not (2 <= len(title) <= 60):
                return None, '标题需为 2～60 个字'
            out['title'] = title
        if 'summary' in p:
            summary = str(p.get('summary', '')).strip()
            if len(summary) > 200:
                return None, '摘要不超过 200 字'
            out['summary'] = summary
        if 'tags' in p:
            tags = p.get('tags', [])
            if not isinstance(tags, list) or len(tags) > 6:
                return None, '标签最多 6 个'
            tags = [str(t).strip() for t in tags if str(t).strip()]
            if any(len(t) > 8 for t in tags):
                return None, '每个标签不超过 8 个字'
            out['tags'] = tags
        if 'body' in p:
            body = p.get('body', [])
            msg = _check_body(body)
            if msg:
                return None, msg
            out['body'] = body
        return out, None

    def _check_body(body):
        if not isinstance(body, list) or not body:
            return '正文至少包含一个内容块'
        for b in body:
            if not isinstance(b, list) or len(b) < 2:
                return '正文内容块格式不正确'
            t = b[0]
            if t in ('p', 'h', 'note'):
                if not isinstance(b[1], str) or not b[1].strip():
                    return '段落 / 标题 / 提示块内容不能为空'
            elif t in ('ul', 'ol'):
                items = b[1]
                if not isinstance(items, list) or not items:
                    return '列表块至少包含一项'
                if any(not isinstance(x, str) or not x.strip() for x in items):
                    return '列表项必须是非空文字'
            elif t == 'table':
                rows = b[1]
                if not isinstance(rows, list) or not rows:
                    return '表格至少包含一行'
                if any(not isinstance(r, list) or not r or
                       any(not isinstance(c, str) for c in r) for r in rows):
                    return '表格行列格式不正确'
            else:
                return '不支持的正文块类型：%s' % t
        return None

    # ================= 健康检查 =================
    @app.get('/api/health')
    def health():
        return jsonify({'ok': True, 'name': '蕙心网', 'service': 'huixin-server'})

    # ================= 账户 =================
    @app.post('/api/auth/register')
    def register():
        p = request.get_json(silent=True) or {}
        name = str(p.get('name', '')).strip()
        pwd = str(p.get('password', ''))
        if not valid_name(name):
            return err('用户名需为 2～16 位中文、字母、数字或下划线')
        if len(pwd) < 6:
            return err('密码至少需要 6 位')
        db = get_db()
        if db.execute('SELECT id FROM users WHERE name = ?', (name,)).fetchone():
            return err('该用户名已被注册')
        cur = db.execute(
            'INSERT INTO users (name, pwd_hash, role, created_at) VALUES (?,?,?,?)',
            (name, hash_password(pwd), 'user', now_iso()))
        db.commit()
        row = db.execute('SELECT * FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
        token = create_session(row['id'])
        return jsonify({'token': token, 'user': user_public(row)})

    @app.post('/api/auth/login')
    def login():
        p = request.get_json(silent=True) or {}
        name = str(p.get('name', '')).strip()
        pwd = str(p.get('password', ''))
        row = get_db().execute('SELECT * FROM users WHERE name = ?', (name,)).fetchone()
        if row is None or not verify_password(pwd, row['pwd_hash']):
            return err('用户名或密码不正确', 401)
        token = create_session(row['id'])
        return jsonify({'token': token, 'user': user_public(row)})

    @app.post('/api/auth/logout')
    def logout():
        destroy_session(get_token())
        return jsonify({'ok': True})

    @app.get('/api/auth/me')
    def me():
        u = current()
        return jsonify({'user': user_public(u) if u else None})

    # ================= 科普卡（公开） =================
    @app.get('/api/cards')
    def list_cards():
        cat = request.args.get('cat', '').strip()
        q = request.args.get('q', '').strip().lower()
        sql = "SELECT * FROM cards WHERE status = 'approved'"
        args = []
        if cat:
            sql += ' AND cat = ?'
            args.append(cat)
        rows = get_db().execute(sql, args).fetchall()
        out = [card_public(r) for r in rows]
        if q:
            out = [k for k in out
                   if q in (k['title'] + k['summary'] + ''.join(k['tags']) + k['cat']).lower()]
        return jsonify({'cards': out, 'total': len(out)})

    @app.get('/api/categories')
    def categories():
        rows = get_db().execute(
            """SELECT cat, COUNT(*) AS n FROM cards
               WHERE status = 'approved' GROUP BY cat ORDER BY cat""").fetchall()
        return jsonify({'categories': [{'cat': r['cat'], 'count': r['n']} for r in rows]})

    @app.get('/api/cards/<int:cid>')
    def card_detail(cid):
        row = get_db().execute(
            "SELECT * FROM cards WHERE id = ? AND status = 'approved'", (cid,)).fetchone()
        if row is None:
            abort(404)
        return jsonify(card_public(row, with_body=True))

    @app.post('/api/clicks')
    def add_click():
        p = request.get_json(silent=True) or {}
        ctype = str(p.get('type', ''))
        target = str(p.get('target', '')).strip()
        if ctype not in ('section', 'card') or not (1 <= len(target) <= 60):
            return err('点击事件格式不正确')
        u = current()
        get_db().execute(
            'INSERT INTO clicks (user_id, type, target, created_at) VALUES (?,?,?,?)',
            (u['id'] if u else None, ctype, target, now_iso()))
        get_db().commit()
        return jsonify({'ok': True})

    # ================= 投稿（登录用户） =================
    @app.post('/api/cards/submit')
    def submit_card():
        u = require_user()
        p = request.get_json(silent=True) or {}
        data, msg = validate_card_payload(p)
        if msg:
            return err(msg)
        db = get_db()
        cur = db.execute(
            """INSERT INTO cards (slug, cat, title, summary, tags, body,
                                  source, author_id, status, created_at)
               VALUES ('',?,?,?,?,?,?,?,'pending',?)""",
            (data['cat'], data['title'], data.get('summary', ''),
             json.dumps(data.get('tags', []), ensure_ascii=False),
             json.dumps(data.get('body', []), ensure_ascii=False),
             'user', u['id'], now_iso()))
        db.commit()
        row = db.execute('SELECT * FROM cards WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify(card_public(row, with_body=True)), 201

    @app.get('/api/my/cards')
    def my_cards():
        u = require_user()
        rows = get_db().execute(
            'SELECT * FROM cards WHERE author_id = ? ORDER BY id DESC', (u['id'],)).fetchall()
        return jsonify({'cards': [card_public(r, with_body=True) for r in rows]})

    # ================= 管理员：卡片管理 =================
    @app.get('/api/admin/cards')
    def admin_list_cards():
        require_admin()
        status = request.args.get('status', '').strip()
        if status:
            rows = get_db().execute(
                'SELECT * FROM cards WHERE status = ? ORDER BY id DESC', (status,)).fetchall()
        else:
            rows = get_db().execute('SELECT * FROM cards ORDER BY id DESC').fetchall()
        return jsonify({'cards': [card_public(r, with_body=True) for r in rows]})

    @app.post('/api/admin/cards')
    def admin_create_card():
        require_admin()
        p = request.get_json(silent=True) or {}
        data, msg = validate_card_payload(p)
        if msg:
            return err(msg)
        db = get_db()
        cur = db.execute(
            """INSERT INTO cards (slug, cat, title, summary, tags, body,
                                  source, author_id, status, created_at, reviewed_at)
               VALUES ('',?,?,?,?,?,?,?,'approved',?,?)""",
            (data['cat'], data['title'], data.get('summary', ''),
             json.dumps(data.get('tags', []), ensure_ascii=False),
             json.dumps(data.get('body', []), ensure_ascii=False),
             'admin', None, now_iso(), now_iso()))
        db.commit()
        row = db.execute('SELECT * FROM cards WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify(card_public(row, with_body=True)), 201

    @app.put('/api/admin/cards/<int:cid>')
    def admin_update_card(cid):
        require_admin()
        row = get_db().execute('SELECT * FROM cards WHERE id = ?', (cid,)).fetchone()
        if row is None:
            abort(404)
        data, msg = validate_card_payload(request.get_json(silent=True) or {}, partial=True)
        if msg:
            return err(msg)
        fields, vals = [], []
        mapping = {
            'cat': 'cat', 'title': 'title', 'summary': 'summary',
        }
        for key, col in mapping.items():
            if key in data:
                fields.append(col + ' = ?')
                vals.append(data[key])
        if 'tags' in data:
            fields.append('tags = ?')
            vals.append(json.dumps(data['tags'], ensure_ascii=False))
        if 'body' in data:
            fields.append('body = ?')
            vals.append(json.dumps(data['body'], ensure_ascii=False))
        if not fields:
            return err('没有需要更新的字段')
        vals.append(cid)
        db = get_db()
        db.execute('UPDATE cards SET ' + ', '.join(fields) + ' WHERE id = ?', vals)
        db.commit()
        row = db.execute('SELECT * FROM cards WHERE id = ?', (cid,)).fetchone()
        return jsonify(card_public(row, with_body=True))

    @app.delete('/api/admin/cards/<int:cid>')
    def admin_delete_card(cid):
        require_admin()
        db = get_db()
        cur = db.execute('DELETE FROM cards WHERE id = ?', (cid,))
        db.commit()
        if cur.rowcount == 0:
            abort(404)
        return jsonify({'ok': True})

    @app.post('/api/admin/cards/<int:cid>/approve')
    def admin_approve(cid):
        require_admin()
        db = get_db()
        cur = db.execute(
            "UPDATE cards SET status = 'approved', reject_reason = '', reviewed_at = ? WHERE id = ?",
            (now_iso(), cid))
        db.commit()
        if cur.rowcount == 0:
            abort(404)
        row = db.execute('SELECT * FROM cards WHERE id = ?', (cid,)).fetchone()
        return jsonify(card_public(row, with_body=True))

    @app.post('/api/admin/cards/<int:cid>/reject')
    def admin_reject(cid):
        require_admin()
        reason = str((request.get_json(silent=True) or {}).get('reason', '')).strip()
        db = get_db()
        cur = db.execute(
            "UPDATE cards SET status = 'rejected', reject_reason = ?, reviewed_at = ? WHERE id = ?",
            (reason[:120], now_iso(), cid))
        db.commit()
        if cur.rowcount == 0:
            abort(404)
        row = db.execute('SELECT * FROM cards WHERE id = ?', (cid,)).fetchone()
        return jsonify(card_public(row, with_body=True))

    # ================= 管理员：用户与统计 =================
    @app.get('/api/admin/users')
    def admin_users():
        require_admin()
        rows = get_db().execute(
            """SELECT u.*,
                      (SELECT COUNT(*) FROM assessments a WHERE a.user_id = u.id) AS assess_n
               FROM users u ORDER BY u.id""").fetchall()
        out = [dict(user_public(r), assess_count=r['assess_n']) for r in rows]
        return jsonify({'users': out})

    @app.get('/api/admin/stats')
    def admin_stats():
        require_admin()
        db = get_db()
        sections = db.execute(
            """SELECT target, COUNT(*) AS n FROM clicks
               WHERE type = 'section' GROUP BY target ORDER BY n DESC""").fetchall()
        cards = db.execute(
            """SELECT c.id, c.title, c.cat,
                      (SELECT COUNT(*) FROM clicks k
                       WHERE k.type = 'card' AND k.target = CAST(c.id AS TEXT)) AS n
               FROM cards c
               WHERE c.status = 'approved'
               ORDER BY n DESC, c.id""").fetchall()
        daily = db.execute(
            """SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM clicks
               GROUP BY d ORDER BY d DESC LIMIT 14""").fetchall()
        totals = {
            'users': db.execute('SELECT COUNT(*) n FROM users').fetchone()['n'],
            'cards_approved': db.execute(
                "SELECT COUNT(*) n FROM cards WHERE status='approved'").fetchone()['n'],
            'cards_pending': db.execute(
                "SELECT COUNT(*) n FROM cards WHERE status='pending'").fetchone()['n'],
            'cards_rejected': db.execute(
                "SELECT COUNT(*) n FROM cards WHERE status='rejected'").fetchone()['n'],
            'assessments': db.execute('SELECT COUNT(*) n FROM assessments').fetchone()['n'],
            'clicks': db.execute('SELECT COUNT(*) n FROM clicks').fetchone()['n'],
        }
        return jsonify({
            'totals': totals,
            'sections': [{'target': r['target'], 'count': r['n']} for r in sections],
            'cards': [{'id': r['id'], 'title': r['title'], 'cat': r['cat'],
                       'count': r['n']} for r in cards],
            'daily': [{'date': r['d'], 'count': r['n']} for r in reversed(list(daily))],
        })

    # ================= 自评数据云端同步 =================
    @app.post('/api/assessments/sync')
    def sync_assessments():
        u = require_user()
        p = request.get_json(silent=True) or {}
        items = p.get('items', [])
        if not isinstance(items, list) or len(items) > 60:
            return err('同步条目需为不超过 60 条的列表')
        db = get_db()
        inserted = updated = 0
        for it in items:
            if not isinstance(it, dict):
                continue
            client_at = str(it.get('at', '')).strip()
            if not client_at:
                continue
            payload = it.get('data', it)
            existed = db.execute(
                'SELECT id FROM assessments WHERE user_id = ? AND client_at = ?',
                (u['id'], client_at)).fetchone()
            db.execute(
                """INSERT INTO assessments (user_id, client_at, payload, created_at)
                   VALUES (?,?,?,?)
                   ON CONFLICT(user_id, client_at) DO UPDATE SET payload = excluded.payload""",
                (u['id'], client_at,
                 json.dumps(payload, ensure_ascii=False), now_iso()))
            if existed:
                updated += 1
            else:
                inserted += 1
        db.commit()
        total = db.execute('SELECT COUNT(*) n FROM assessments WHERE user_id = ?',
                           (u['id'],)).fetchone()['n']
        return jsonify({'inserted': inserted, 'updated': updated, 'total': total})

    @app.get('/api/assessments')
    def list_assessments():
        u = require_user()
        rows = get_db().execute(
            'SELECT client_at, payload FROM assessments WHERE user_id = ? ORDER BY client_at DESC',
            (u['id'],)).fetchall()
        out = []
        for r in rows:
            try:
                out.append(json.loads(r['payload']))
            except json.JSONDecodeError:
                continue
        return jsonify({'assessments': out, 'total': len(out)})

    # ================= 静态文件托管 =================
    @app.after_request
    def no_cache_api(resp):
        # API GET 响应禁止启发式缓存，保证统计等数据实时
        if request.path.startswith('/api/'):
            resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.get('/')
    def index_page():
        return send_from_directory(ROOT, 'index.html')

    @app.get('/<path:fname>')
    def static_any(fname):
        # 仅允许项目根目录内真实存在的文件（send_from_directory 自动防目录穿越）
        full = os.path.join(ROOT, fname.replace('/', os.sep))
        if os.path.isfile(full):
            return send_from_directory(ROOT, fname)
        abort(404)

    return app
