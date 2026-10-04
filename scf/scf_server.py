"""蕙心网 · 腾讯云 SCF Web 函数入口

部署包结构（zip 根）：
  scf_bootstrap        启动脚本
  scf_server.py        本文件：启动 WSGI 服务，监听 0.0.0.0:9000
  vendor/              Linux 版 Python 依赖（构建脚本预装）
  backend/             业务代码（与本地 / Vercel 完全同一份）

业务代码零分叉：仍然通过 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN /
HX_SMTP_* 等环境变量读取配置（在 SCF 控制台「函数配置 → 环境变量」中填写）。
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# zip 根与 vendor 都加入模块搜索路径
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'vendor'))

from waitress import serve  # noqa: E402

from backend.app import create_app  # noqa: E402

app = create_app()


class GatewayPrefixMiddleware:
    """API 网关默认访问地址可能带阶段前缀（/release、/test、/prepub），
    透传进函数时剥掉，让 Flask 路由始终看到 /api/... 这样的干净路径。
    不带前缀的「函数 URL」访问则原样放行。"""

    PREFIXES = ('/release', '/test', '/prepub')

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        for prefix in self.PREFIXES:
            if path == prefix:
                environ['PATH_INFO'] = '/'
                environ['SCRIPT_NAME'] = prefix
                break
            if path.startswith(prefix + '/'):
                environ['PATH_INFO'] = path[len(prefix):]
                environ['SCRIPT_NAME'] = prefix
                break
        return self.wsgi_app(environ, start_response)


app.wsgi_app = GatewayPrefixMiddleware(app.wsgi_app)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '9000'))
    print('[蕙心网][SCF] WSGI 服务启动于 0.0.0.0:%d' % port, flush=True)
    serve(
        app,
        host='0.0.0.0',
        port=port,
        threads=8,
        channel_timeout=60,
        connection_limit=64,
        clear_untrusted_proxy_headers=False,
    )
