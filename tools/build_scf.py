# -*- coding: utf-8 -*-
"""蕙心网 · 腾讯云 SCF Web 函数部署包构建脚本（Windows / macOS / Linux 均可运行）

产物：dist_scf/huixin-scf.zip —— 直接在 SCF 控制台「本地上传 zip」部署。

做的事情：
1. 准备干净的暂存目录，放入 scf_bootstrap / scf_server.py / backend 业务代码；
2. 用 pip 按 SCF Python 3.10 + manylinux2014_x86_64 目标把依赖装进 vendor/
   （在 Windows 上交叉拉取 Linux 预编译轮，如 libsql_experimental 的 .so）；
3. 打包为 zip，scf_bootstrap 强制 LF 换行并赋予 0755 可执行权限。
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCF_DIR = os.path.join(ROOT, 'scf')
DIST_DIR = os.path.join(ROOT, 'dist_scf')
PKG_DIR = os.path.join(DIST_DIR, 'pkg')
ZIP_PATH = os.path.join(DIST_DIR, 'huixin-scf.zip')

# SCF Python 3.10 运行时（CentOS 兼容环境，manylinux2014 轮可直接用）
PIP_TARGET = [
    '--platform', 'manylinux2014_x86_64',
    '--platform', 'any',
    '--python-version', '310',
    '--implementation', 'cp',
    '--abi', 'cp310',
    '--only-binary=:all:',
]


def ignore_pycache(_src, names):
    return [n for n in names if n == '__pycache__' or n.endswith(('.pyc', '.pyo'))]


def main():
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(PKG_DIR)

    # 1. 入口与启动脚本放到 zip 根
    shutil.copy2(os.path.join(SCF_DIR, 'scf_server.py'),
                 os.path.join(PKG_DIR, 'scf_server.py'))
    shutil.copy2(os.path.join(SCF_DIR, 'scf_bootstrap'),
                 os.path.join(PKG_DIR, 'scf_bootstrap'))

    # 2. 业务代码（不含本地数据库等 data 目录）
    shutil.copytree(os.path.join(ROOT, 'backend'),
                    os.path.join(PKG_DIR, 'backend'),
                    ignore=ignore_pycache)

    # 3. 交叉安装 Linux 依赖到 vendor/
    vendor_dir = os.path.join(PKG_DIR, 'vendor')
    os.makedirs(vendor_dir)
    cmd = [
        sys.executable, '-m', 'pip', 'install',
        '-r', os.path.join(SCF_DIR, 'requirements.txt'),
        '-t', vendor_dir,
        '--quiet', '--disable-pip-version-check',
    ] + PIP_TARGET
    print('[build] 安装 Linux 依赖到 vendor/ ...')
    subprocess.check_call(cmd)

    # 4. 清理缓存与无用元数据
    removed = 0
    for dirpath, dirnames, filenames in os.walk(vendor_dir):
        for d in list(dirnames):
            if d == '__pycache__':
                shutil.rmtree(os.path.join(dirpath, d), ignore_errors=True)
                dirnames.remove(d)
                removed += 1
        for f in filenames:
            if f.endswith(('.pyc', '.pyo')):
                os.remove(os.path.join(dirpath, f))
                removed += 1
    if removed:
        print('[build] 清理缓存文件 %d 个' % removed)

    # 5. 打包 zip；bootstrap 必须 LF + 0755
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(PKG_DIR):
            for f in sorted(filenames):
                full = os.path.join(dirpath, f)
                arc = os.path.relpath(full, PKG_DIR).replace(os.sep, '/')
                if arc == 'scf_bootstrap':
                    with open(full, 'rb') as fh:
                        data = fh.read().replace(b'\r\n', b'\n')
                    info = zipfile.ZipInfo(arc)
                    info.external_attr = 0o100755 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    zf.writestr(info, data)
                else:
                    zf.write(full, arc)

    size_kb = os.path.getsize(ZIP_PATH) / 1024
    print('[build] 完成 -> %s (%.1f KB)' % (ZIP_PATH, size_kb))
    if size_kb > 48000:
        print('[build] 警告：超过控制台 50MB 直传上限，请改用 COS 上传部署')


if __name__ == '__main__':
    main()
