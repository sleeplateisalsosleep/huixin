"""蕙心网后端 · Flask 应用工厂
功能：
- 用户账户（邮箱验证码注册/登录 · 管理员密码兜底 · 会话令牌）
- 核心功能二科普卡内容管理与投稿审核
- 点击量数据统计
- 自评数据云端同步
- 护理建议用户反馈收集（登录 / 匿名均可）与管理员查看
- 同端口托管前端静态文件（免跨域）
"""
import json
import os
import smtplib
import ssl
from datetime import datetime, timedelta
from email.mime.text import MIMEText

from flask import (Flask, Response, abort, jsonify, request,
                   send_from_directory)

from . import db as dbmod
from .db import (ROOT, card_public, close_db, get_db, init_db, now_iso,
                 user_public)
from .security import (create_session, destroy_session, gen_code, hash_password,
                       session_user, valid_email, valid_name, verify_password)

ADMIN_DEFAULT_PWD = 'Huixin@2026'
CODE_TTL_MINUTES = 5
CODE_RESEND_SECONDS = 60


def create_app():
    app = Flask(__name__)
    app.teardown_appcontext(close_db)

    # ---------------- CORS：允许 GitHub Pages 等静态站点跨域调用 ----------------
    # 可用 HX_ALLOWED_ORIGINS=http://a,https://b 追加可信来源；
    # localhost / 127.0.0.1 任意端口自动放行，方便本地开发。
    allowed_origins = {
        o.strip() for o in os.environ.get('HX_ALLOWED_ORIGINS', '').split(',')
        if o.strip()
    }
    allowed_origins.add('https://sleeplateisalsosleep.github.io')
    CORS_HEADERS = 'Content-Type, X-Auth-Token, Authorization'
    CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS'

    def cors_origin():
        origin = request.headers.get('Origin', '')
        if not origin:
            return ''
        if origin in allowed_origins:
            return origin
        host = origin.rsplit('://', 1)[-1].split('/')[0]
        if host in ('localhost', '127.0.0.1') or \
                host.startswith(('localhost:', '127.0.0.1:')):
            return origin
        return ''

    @app.before_request
    def cors_preflight():
        # 带 X-Auth-Token / JSON 的请求会先发 OPTIONS 预检
        if request.method == 'OPTIONS' and cors_origin():
            return Response(status=204, headers={
                'Access-Control-Allow-Origin': cors_origin(),
                'Access-Control-Allow-Headers': CORS_HEADERS,
                'Access-Control-Allow-Methods': CORS_METHODS,
                'Access-Control-Max-Age': '86400',
                'Vary': 'Origin',
            })

    @app.after_request
    def cors_headers(resp):
        origin = cors_origin()
        if origin:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Vary'] = 'Origin'
            resp.headers['Access-Control-Allow-Headers'] = CORS_HEADERS
            resp.headers['Access-Control-Allow-Methods'] = CORS_METHODS
        return resp

    # ---------------- 配置加载：环境变量优先，data/smtp.json 兜底 ----------------
    cfg_path = os.path.join(dbmod.ROOT, 'data', 'smtp.json')
    file_cfg = {}
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, encoding='utf-8') as f:
                file_cfg = json.load(f) or {}
        except (OSError, json.JSONDecodeError):
            file_cfg = {}

    def cfg(key, env, default=''):
        return os.environ.get(env) or str(file_cfg.get(key, '') or default)

    admin_email = cfg('admin_email', 'HX_ADMIN_EMAIL', 'admin@huixin.local')
    admin_created, cards_added = init_db(hash_password(ADMIN_DEFAULT_PWD), admin_email)
    if admin_created:
        print('[蕙心网] 已生成管理员账号  admin / %s  邮箱 %s' % (ADMIN_DEFAULT_PWD, admin_email))
    if cards_added:
        print('[蕙心网] 已导入内置科普卡片 %d 条' % cards_added)

    # ---------------- 邮件发送（SMTP 未配置时打印到控制台） ----------------
    SMTP_HOST = cfg('host', 'HX_SMTP_HOST')
    SMTP_PORT = int(cfg('port', 'HX_SMTP_PORT', '465'))
    SMTP_USER = cfg('user', 'HX_SMTP_USER')
    SMTP_PASS = cfg('pass', 'HX_SMTP_PASS')
    SMTP_FROM = cfg('from', 'HX_SMTP_FROM') or SMTP_USER
    SMTP_TLS = cfg('tls', 'HX_SMTP_TLS', '1') == '1'
    SMTP_READY = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)

    if not SMTP_READY:
        print('[蕙心网] 未配置 SMTP（data/smtp.json 或 HX_SMTP_HOST/USER/PASS），验证码将打印到服务端控制台')
    else:
        print('[蕙心网] SMTP 已配置：%s via %s:%d' % (SMTP_USER, SMTP_HOST, SMTP_PORT))

    def send_mail(to_addr, subject, body):
        """发送邮件；SMTP 未配置时返回 False 并打印到控制台。"""
        if not SMTP_READY:
            print('[蕙心网][邮件-控制台] → %s\n  主题: %s\n  内容: %s' % (to_addr, subject, body))
            return False
        try:
            msg = MIMEText(body, 'plain', 'utf-8')
            msg['Subject'] = subject
            msg['From'] = SMTP_FROM
            msg['To'] = to_addr
            if SMTP_PORT == 465:
                ctx = ssl.create_default_context()
                with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as s:
                    s.login(SMTP_USER, SMTP_PASS)
                    s.sendmail(SMTP_FROM, [to_addr], msg.as_string())
            else:
                with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
                    if SMTP_TLS:
                        s.starttls(context=ssl.create_default_context())
                    s.login(SMTP_USER, SMTP_PASS)
                    s.sendmail(SMTP_FROM, [to_addr], msg.as_string())
            return True
        except Exception as e:
            print('[蕙心网][邮件发送失败] %s: %s' % (to_addr, e))
            return False

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

    # ================= 账户：邮箱验证码 =================
    @app.post('/api/auth/send-code')
    def send_code():
        """向邮箱发送 6 位验证码（5 分钟有效，60 秒内不可重复发送）。"""
        p = request.get_json(silent=True) or {}
        email = str(p.get('email', '')).strip().lower()
        if not valid_email(email):
            return err('请输入正确的邮箱地址')
        db = get_db()
        # 频率限制：同一邮箱 60 秒内只能发送一次
        recent = db.execute(
            "SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1",
            (email,)).fetchone()
        if recent:
            try:
                sent_at = datetime.fromisoformat(recent['created_at'])
                if (datetime.now() - sent_at).total_seconds() < CODE_RESEND_SECONDS:
                    wait = CODE_RESEND_SECONDS - int((datetime.now() - sent_at).total_seconds())
                    return err('请 %d 秒后再获取验证码' % max(wait, 1))
            except ValueError:
                pass
        code = gen_code(6)
        now = datetime.now()
        expires = (now + timedelta(minutes=CODE_TTL_MINUTES)).isoformat(timespec='seconds')
        db.execute(
            "INSERT INTO email_codes (email, code, created_at, expires_at) VALUES (?,?,?,?)",
            (email, code, now.isoformat(timespec='seconds'), expires))
        db.commit()
        subject = '蕙心网验证码'
        body = ('【蕙心网】您的验证码为 %s，%d 分钟内有效。\n'
                '如非本人操作，请忽略本邮件。' % (code, CODE_TTL_MINUTES))
        send_mail(email, subject, body)
        return jsonify({'ok': True, 'ttl': CODE_TTL_MINUTES * 60, 'sent': SMTP_READY})

    @app.post('/api/auth/verify')
    def verify_code():
        """邮箱 + 验证码登录/注册（邮箱不存在则自动注册）。"""
        p = request.get_json(silent=True) or {}
        email = str(p.get('email', '')).strip().lower()
        code = str(p.get('code', '')).strip()
        if not valid_email(email):
            return err('请输入正确的邮箱地址')
        if not code.isdigit() or len(code) != 6:
            return err('请输入 6 位数字验证码')
        db = get_db()
        row = db.execute(
            "SELECT * FROM email_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1",
            (email,)).fetchone()
        if row is None:
            return err('请先获取验证码', 401)
        try:
            expires = datetime.fromisoformat(row['expires_at'])
        except ValueError:
            return err('验证码已失效', 401)
        if datetime.now() > expires:
            return err('验证码已过期，请重新获取', 401)
        if code != row['code']:
            return err('验证码不正确', 401)
        db.execute("UPDATE email_codes SET used = 1 WHERE id = ?", (row['id'],))
        # 查找或创建用户
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user is None:
            # 用邮箱本地部分作为显示名（冲突则追加序号）
            local = email.split('@')[0]
            name = local
            i = 1
            while db.execute('SELECT id FROM users WHERE name = ?', (name,)).fetchone():
                i += 1
                name = '%s%d' % (local, i)
            cur = db.execute(
                'INSERT INTO users (name, email, pwd_hash, role, created_at) VALUES (?,?,?,?,?)',
                (name, email, None, 'user', now_iso()))
            user = db.execute('SELECT * FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
        db.commit()
        token = create_session(user['id'])
        return jsonify({'token': token, 'user': user_public(user)})

    @app.post('/api/auth/login')
    def login():
        """管理员密码登录（保留作为后台兜底入口）。"""
        p = request.get_json(silent=True) or {}
        name = str(p.get('name', '')).strip()
        pwd = str(p.get('password', ''))
        row = get_db().execute('SELECT * FROM users WHERE name = ?', (name,)).fetchone()
        if row is None or not row['pwd_hash'] or not verify_password(pwd, row['pwd_hash']):
            return err('用户名或密码不正确', 401)
        token = create_session(row['id'])
        return jsonify({'token': token, 'user': user_public(row)})

    @app.post('/api/auth/register')
    def register():
        """兼容旧版用户名+密码注册（仍可用，但推荐邮箱验证码）。"""
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

    # ================= 用户反馈（非必填，登录与否均可） =================
    FB_CHOICES = ('helpful', 'not_helpful', 'worse')

    @app.post('/api/feedback')
    def add_feedback():
        p = request.get_json(silent=True) or {}
        choice = str(p.get('choice', '')).strip()
        text = str(p.get('text', '')).strip()
        assess_at = str(p.get('assess_at', '')).strip()
        if choice and choice not in FB_CHOICES:
            return err('反馈选项不正确')
        if len(text) > 200:
            return err('护理建议评价不超过 200 字')
        if not choice and not text:
            return err('请选择反馈选项或填写一句评价')
        u = current()
        db = get_db()
        db.execute(
            """INSERT INTO feedback (user_id, choice, text, assess_at, created_at)
               VALUES (?,?,?,?,?)""",
            (u['id'] if u else None, choice, text, assess_at[:40], now_iso()))
        db.commit()
        return jsonify({'ok': True}), 201

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

    @app.get('/api/admin/feedback')
    def admin_feedback():
        """查看所有用户反馈（最新在前），未登录提交者显示为「未登录用户」。"""
        require_admin()
        rows = get_db().execute(
            """SELECT f.id, f.choice, f.text, f.assess_at, f.created_at,
                      u.name AS user_name
               FROM feedback f LEFT JOIN users u ON u.id = f.user_id
               ORDER BY f.id DESC""").fetchall()
        return jsonify({'feedback': [
            {'id': r['id'],
             'user': r['user_name'] if r['user_name'] else '未登录用户',
             'choice': r['choice'], 'text': r['text'],
             'assess_at': r['assess_at'], 'created_at': r['created_at']}
            for r in rows]})

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
            'feedback': db.execute('SELECT COUNT(*) n FROM feedback').fetchone()['n'],
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
        # 私有目录与敏感后缀一律不允许通过 HTTP 访问（数据库、SMTP 授权码、源码等）
        first = fname.split('/', 1)[0].lower()
        if first in ('data', 'backend', 'tools', '__pycache__', '.git', '.trae'):
            abort(404)
        if fname.lower().endswith(('.py', '.pyc', '.json', '.db', '.log')):
            abort(404)
        # 仅允许项目根目录内真实存在的文件（send_from_directory 自动防目录穿越）
        full = os.path.join(ROOT, fname.replace('/', os.sep))
        if os.path.isfile(full):
            return send_from_directory(ROOT, fname)
        abort(404)

    return app
