@echo off
title Amadeus - One-Click Update
REM ============================================================
REM  One-click update: build -> assemble -> sync -> launch
REM  Deploy folder is auto-detected (folder containing _up_\.next\standalone)
REM ============================================================
setlocal enabledelayedexpansion
cd /d E:\Amadeus\amadeus
set LOG=E:\Amadeus\update-amadeus.log

echo ============================================================ > "%LOG%"
echo Amadeus Update - %date% %time% >> "%LOG%"

REM ---- auto-detect deploy folder: contains _up_\.next\standalone\amadeus\.next\BUILD_ID ----
REM NOTE: must scan TWO levels deep. The real path is
REM   E://<deploy-dir>//Amadeus//_up_//...
REM i.e. one extra Chinese-named folder level. The old one-level scan (E:\*)
REM silently failed on 2026-10-12 with "[ERROR] Deploy folder not found".
set DEPLOY=
for /d %%d in ("E:\*") do (
  if exist "%%~fd\_up_\.next\standalone\amadeus\.next\BUILD_ID" (
    set "DEPLOY=%%~fd"
  ) else (
    for /d %%e in ("%%~fd\*") do (
      if exist "%%~e\_up_\.next\standalone\amadeus\.next\BUILD_ID" (
        set "DEPLOY=%%~e"
      )
    )
  )
)
REM de-duplicate: a root-level hit wins over a deeper one (loop order overwrites)
if "%DEPLOY%"=="" (
  echo [ERROR] Deploy folder not found. Scanned E:\*\ and E:\*\* for _up_\.next\standalone >> "%LOG%"
  echo.
  echo ============================================================
  echo  FAILED: 找不到部署目录
  echo.
  echo  脚本在 E:\ 下一层和两层里找 _up_\.next\standalone 都没找到。
  echo  部署目录应该长这样：  E:\某文件夹\Amadeus\_up_\.next\standalone
  echo.
  echo  技术细节见日志： E:\Amadeus\update-amadeus.log
  echo ============================================================
  timeout /t 15 >nul
  exit /b 1
)
echo [INFO] Deploy folder: %DEPLOY% >> "%LOG%"

REM ---- 1. stop running app + sidecar ----
echo [1/6] Stopping running app and sidecar...
taskkill /IM app.exe /F >> "%LOG%" 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /PID %%p /F >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

REM ---- 2. clean old build ----
echo [2/6] Cleaning .next ...
if exist .next rd /s /q .next >> "%LOG%" 2>&1

REM ---- 3. build ----
echo [3/6] Building Next.js (1-3 min, see update-amadeus.log)...
call npx next build >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] next build failed >> "%LOG%"
  echo.
  echo ============================================================
  echo  FAILED: next build 失败
  echo.
  echo  原因见日志最后 30 行： E:\Amadeus\update-amadeus.log
  echo  Common causes: low disk space, or the previous build process did not exit cleanly
  echo ============================================================
  timeout /t 15 >nul
  exit /b 1
)

REM ---- 4. assemble sidecar runtime (node.exe / start.js / sidecar-info.json) ----
echo [4/6] Assembling sidecar runtime...
call node scripts\build-for-tauri.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] build-for-tauri failed >> "%LOG%"
  echo.
  echo ============================================================
  echo  FAILED: 组装 sidecar 运行时失败
  echo  这一步会生成 node.exe / start.js / sidecar-info.json，缺了 app.exe 起不来
  echo  原因见日志： E:\Amadeus\update-amadeus.log
  echo ============================================================
  timeout /t 15 >nul
  exit /b 1
)

REM ---- 5. sync whole standalone to deploy folder ----
echo [5/6] Syncing to deploy folder...
rd /s /q "%DEPLOY%\_up_\.next\standalone" >> "%LOG%" 2>&1
xcopy /E /I /Q /Y ".next\standalone" "%DEPLOY%\_up_\.next\standalone" >> "%LOG%" 2>&1
if not exist "%DEPLOY%\_up_\.next\standalone\node.exe" (
  echo [ERROR] sync failed - node.exe missing in deploy folder >> "%LOG%"
  echo.
  echo ============================================================
  echo  FAILED: 同步失败，部署目录里没有 node.exe
  echo  部署目录： %DEPLOY%
  echo  原因：多半是 app.exe 还在运行锁着文件，先关掉再重试
  echo ============================================================
  timeout /t 15 >nul
  exit /b 1
)

REM ---- 2026-10-25: local voice engine (tts-local) feature removed ----
REM The junction/junk-cleanup blocks for tts-local are gone with it.

REM ---- verify build id ----
set NEWID=
set DEPLOYID=
for /f "usebackq delims=" %%b in (".next\BUILD_ID") do set NEWID=%%b
for /f "usebackq delims=" %%b in ("%DEPLOY%\_up_\.next\standalone\amadeus\.next\BUILD_ID") do set DEPLOYID=%%b
echo [INFO] BUILD_ID new=%NEWID% deploy=%DEPLOYID% >> "%LOG%"

REM ---- 6. launch ----
echo [6/6] Launching Amadeus...
start "" "%DEPLOY%\app.exe"

fc /b ".next\BUILD_ID" "%DEPLOY%\_up_\.next\standalone\amadeus\.next\BUILD_ID" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  DONE - with warning
  echo.
  echo  部署 BUILD_ID 和新 build 不一致，软件可能白屏：
  echo    new=   %NEWID%
  echo    deploy=%DEPLOYID%
  echo  关掉软件，删掉 EBWebView 缓存再试
  echo  日志： E:\Amadeus\update-amadeus.log
  echo ============================================================
  timeout /t 15 >nul
  exit /b 0
)

echo.
echo ============================================================
echo  DONE. BUILD_ID: %NEWID%
echo  Deploy: %DEPLOY%
echo  Log: E:\Amadeus\update-amadeus.log
echo.
echo  提醒: 语音合成走云端（阿里云百炼），首次使用需在设置里填 Key 并复刻音色
echo ============================================================
echo.
echo 按任意键关闭窗口...
timeout /t 15 >nul
exit /b 0
