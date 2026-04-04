@echo off
echo Starting Lecture Teller...

:: Check if virtual environment exists
if not exist ".venv\Scripts\activate.bat" (
    echo Error: Virtual environment not found in .venv\
    echo Please create it first: python -m venv .venv
    pause
    exit /b 1
)

:: Activate the virtual environment
call .venv\Scripts\activate.bat

:: Start the FastAPI server using Uvicorn
echo Running FastAPI Server on http://127.0.0.1:8000
echo Main app: http://127.0.0.1:8000/
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload

pause
