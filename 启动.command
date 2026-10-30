#!/bin/bash
# PP幻想 · 3D 打印模型生成器 —— 本地启动脚本（双击即可）
cd "$(dirname "$0")" || exit 1
PORT=8000
( sleep 1; open "http://localhost:$PORT/" ) &
exec python3 server.py "$PORT"
