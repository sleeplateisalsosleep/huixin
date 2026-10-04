"""蕙心网 · Vercel Serverless 入口

vercel.json 把所有 /api/* 请求重写到本函数，
函数内复用 backend/app.py 的 Flask 应用（与本地 server.py 同一套代码）。
"""
import os
import sys

# 确保项目根目录在 sys.path 上，可直接 import backend 包
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from backend.app import create_app  # noqa: E402

app = create_app()
