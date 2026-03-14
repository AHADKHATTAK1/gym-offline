@echo off
echo.
echo ==========================================
echo   GYM PRO V2 - Local Server Starting...
echo ==========================================
echo.

:: Check if Python is available
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Starting server on http://localhost:8080
    echo Open your browser and go to: http://localhost:8080
    echo Press CTRL+C to stop the server.
    echo.
    start "" "http://localhost:8080"
    python -m http.server 8080
) else (
    :: Try python3
    python3 --version >nul 2>&1
    if %errorlevel% == 0 (
        echo Starting server on http://localhost:8080
        start "" "http://localhost:8080"
        python3 -m http.server 8080
    ) else (
        :: Try npx
        npx --version >nul 2>&1
        if %errorlevel% == 0 (
            echo Starting server using Node.js...
            start "" "http://localhost:8080"
            npx serve . -p 8080 -l
        ) else (
            echo ERROR: Python or Node.js is required to run the local server.
            echo Please install Python from: https://python.org
            echo.
            echo Alternatively, open index.html directly in your browser.
            pause
        )
    )
)
