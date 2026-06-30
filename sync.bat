@echo off
cd /d E:\Amadeus
echo ========================================
echo   Amadeus -^> GitHub Sync
echo ========================================
echo.
echo [1/3] Adding changes...
git add -A
echo.
echo [2/3] Committing...
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i
git commit -m "sync %TS%"
echo.
echo [3/3] Pushing to GitHub...
git push origin
echo.
echo ========================================
echo   Done! Press any key to close.
echo ========================================
pause >nul
