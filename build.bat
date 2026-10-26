@echo off
chcp 65001 >nul
rem Сборка JobAssist.exe / Build JobAssist.exe. Требуется Python 3.10+.
cd /d "%~dp0"
python -m venv .venv || goto :err
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r requirements.txt -r requirements-build.txt || goto :err
python -m unittest discover -s tests || goto :err
pyinstaller --noconfirm --onefile --windowed --name JobAssist --add-data "jobassist\web;jobassist\web" --add-data "jobassist\prompts;jobassist\prompts" main.py || goto :err
echo.
echo OK: dist\JobAssist.exe
pause
exit /b 0
:err
echo Build failed.
pause
exit /b 1
