@echo off
REM Example Usage Script for OpenAgents Latency Benchmark (Windows)
REM 
REM This script demonstrates how to run the benchmark and generate plots.
REM Double-click to run or execute from command prompt.

setlocal enabledelayedexpansion

echo ==================================================
echo OpenAgents Latency Benchmark - Example Usage
echo ==================================================
echo.

REM Check if we're in the right directory
if not exist "pyproject.toml" (
    echo ERROR: Please run this script from the openagents root directory
    pause
    exit /b 1
)

REM Step 1: Quick test
echo Step 1: Running quick test (1-2 agents, 10 iterations)...
echo This should take about 10-20 seconds
echo.
python -m openagents.experiments.perf_latency.quick_test
if errorlevel 1 (
    echo ERROR: Quick test failed
    pause
    exit /b 1
)
echo.
echo Quick test completed!
echo.

REM Wait for user
pause
echo.

REM Step 2: Full benchmark (commented out by default)
echo Step 2: Full benchmark is skipped to save time
echo Uncomment the line in this script to run it.
echo.
REM Uncomment the line below to run the full benchmark
REM python -m openagents.experiments.perf_latency.run_openagents_latency
echo.

REM Step 3: Plot results
echo Step 3: Generating plots from quick test results...
echo.
python -m openagents.experiments.perf_latency.plot_latency
if errorlevel 1 (
    echo ERROR: Plotting failed
    pause
    exit /b 1
)
echo.
echo Plots generated!
echo.

REM Summary
echo ==================================================
echo Summary
echo ==================================================
echo.
echo Quick test completed
echo Results saved in test_results\
echo Plots generated (PNG + PDF)
echo.
echo Next steps:
echo   1. View the plots in test_results\
echo   2. Review latency_results_*.json
echo   3. Run full benchmark by uncommenting line in this script
echo   4. Read README.md for more options
echo.
echo ==================================================
echo.
pause

