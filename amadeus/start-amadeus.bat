@echo off
title Amadeus - 启动中...
cd /d E:\Amadeus\amadeus
set RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static
set RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
echo ========================================
echo   Amadeus - 牧濑红莉栖的记忆体
echo   Production 模式启动中，请稍候...
echo ========================================
echo.
echo 首次启动或代码更新后，需要先 build：
echo   npx next build
echo 然后双击此脚本即可。
echo.
npx tauri dev
pause
