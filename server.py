"""蕙心网后端启动入口
用法：
    python server.py            # 默认 127.0.0.1:8200
    python server.py 0.0.0.0 9000
"""
import sys

from backend.app import create_app

app = create_app()

if __name__ == '__main__':
    host = sys.argv[1] if len(sys.argv) > 1 else '127.0.0.1'
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8200
    print('[蕙心网] 服务已启动：http://%s:%d' % (host, port))
    print('[蕙心网] 普通用户：邮箱验证码登录；管理员：admin / Huixin@2026')
    app.run(host=host, port=port, debug=False)
