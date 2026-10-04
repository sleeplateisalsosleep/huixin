"""冒烟：libsql 驱动模式（模拟 Serverless 云端）与本地 sqlite 模式各跑一遍。"""
import os
import sys
import tempfile

ROOT = r"c:\Users\93039\Downloads\huixin-web"
MODE = sys.argv[1] if len(sys.argv) > 1 else "libsql"

if MODE == "libsql":
    db_file = os.path.join(tempfile.gettempdir(), "hx_libsql_smoke.db")
    for suffix in ("", "-wal", "-shm"):
        p = db_file + suffix
        if os.path.exists(p):
            os.remove(p)
    os.environ["TURSO_DATABASE_URL"] = db_file  # 直连本地 libSQL 文件，走同一驱动/包装层
else:
    os.environ.pop("TURSO_DATABASE_URL", None)

sys.path.insert(0, ROOT)
if MODE == "sqlite":
    # 用临时库，避免污染 data/huixin.db
    from backend import db as _dbmod
    _dbmod.DB_PATH = os.path.join(tempfile.gettempdir(), "hx_sqlite_smoke.db")
    if os.path.exists(_dbmod.DB_PATH):
        os.remove(_dbmod.DB_PATH)
from backend.app import create_app  # noqa: E402

app = create_app()
c = app.test_client()
ok = 0


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(extra) if extra else ""))
    if cond:
        ok += 1
    else:
        sys.exit(1)


# 1. 健康检查
check("health", c.get("/api/health").get_json()["ok"] is True)

# 2. CORS 预检（GitHub Pages 来源）
r = c.options("/api/auth/send-code",
              headers={"Origin": "https://sleeplateisalsosleep.github.io"})
check("cors preflight 204", r.status_code == 204)
check("cors allow-origin",
      r.headers.get("Access-Control-Allow-Origin") ==
      "https://sleeplateisalsosleep.github.io")
check("cors allow-headers", "X-Auth-Token" in (r.headers.get("Access-Control-Allow-Headers") or ""))

# 3. 非白名单来源不放行
r = c.get("/api/health", headers={"Origin": "https://evil.example.com"})
check("cors reject unknown origin", not r.headers.get("Access-Control-Allow-Origin"))

# 4. 科普卡已播种
n = c.get("/api/cards").get_json()["total"]
check("seed cards", n >= 30, "total=%d" % n)

# 5. 用户名密码注册（旧入口保留）
r = c.post("/api/auth/register", json={"name": "smoker", "password": "secret123"})
check("register 200", r.status_code == 200, r.status_code)
token = r.get_json()["token"]

r = c.get("/api/auth/me", headers={"X-Auth-Token": token})
check("me", r.get_json()["user"]["name"] == "smoker")

# 6. 投稿
r = c.post("/api/cards/submit", headers={"X-Auth-Token": token},
           json={"cat": "测试", "title": "冒烟测试卡片", "body": [["p", "正文内容"]]})
check("submit card 201", r.status_code == 201, r.status_code)
pid = r.get_json()["id"]

# 7. 匿名反馈
r = c.post("/api/feedback", json={"choice": "helpful", "text": "有用", "assess_at": ""})
check("anonymous feedback 201", r.status_code == 201)

# 8. 管理员登录 / 审核 / 统计
r = c.post("/api/auth/login", json={"name": "admin", "password": "Huixin@2026"})
check("admin login", r.status_code == 200 and r.get_json()["user"]["role"] == "admin")
atoken = r.get_json()["token"]

r = c.get("/api/admin/cards?status=pending", headers={"X-Auth-Token": atoken})
check("admin pending list", any(x["id"] == pid for x in r.get_json()["cards"]))

r = c.post("/api/admin/cards/%d/approve" % pid, headers={"X-Auth-Token": atoken})
check("approve", r.status_code == 200 and r.get_json()["status"] == "approved")

j = c.get("/api/admin/stats", headers={"X-Auth-Token": atoken}).get_json()
check("stats users>=2", j["totals"]["users"] >= 2, j["totals"])
check("stats feedback>=1", j["totals"]["feedback"] >= 1)

# 9. 邮箱验证码（SMTP 未配置 → 控制台兜底，不影响入库校验）
r = c.post("/api/auth/send-code", json={"email": "smoke@example.com"})
check("send-code 200", r.status_code == 200, r.get_json())

# 10. 自评同步 upsert（ON CONFLICT 路径）
payload = {"items": [{"at": "2026-10-04T10:00:00", "data": {"x": 1}}]}
r1 = c.post("/api/assessments/sync", headers={"X-Auth-Token": token}, json=payload)
r2 = c.post("/api/assessments/sync", headers={"X-Auth-Token": token},
            json={"items": [{"at": "2026-10-04T10:00:00", "data": {"x": 2}}]})
check("sync inserted", r1.get_json()["inserted"] == 1, r1.get_json())
check("sync upsert updated", r2.get_json()["updated"] == 1 and r2.get_json()["total"] == 1,
      r2.get_json())

# 11. 未授权访问被拦
check("admin 401 without token",
      c.get("/api/admin/stats").status_code == 401)

print("MODE=%s ALL %d CHECKS PASSED" % (MODE, ok))
