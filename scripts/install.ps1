# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex

$ErrorActionPreference = "Continue"
$VERSION = "0.9.3"
$MIN_PYTHON_MAJOR = 3
$MIN_PYTHON_MINOR = 10

function Write-Info { Write-Host ">>> " -ForegroundColor Cyan -NoNewline; Write-Host $args }
function Write-Ok { Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Warn { Write-Host "[!] " -ForegroundColor Yellow -NoNewline; Write-Host $args }
function Write-Fail {
    Write-Host "[X] " -ForegroundColor Red -NoNewline
    Write-Host $args
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}
function Write-Step { Write-Host ""; Write-Info $args }

# Run a command with an animated spinner. Returns $true on success.
function Run-WithSpinner {
    param([string]$Message, [string[]]$Cmd)
    $spinner = @("|", "/", "-", "\")
    $i = 0

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Cmd[0]
    $psi.Arguments = ($Cmd | Select-Object -Skip 1) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($psi)

    while (-not $proc.HasExited) {
        $char = $spinner[$i % 4]
        Write-Host "`r    $char $Message..." -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 250
        $i++
    }
    $proc.WaitForExit()

    # Clear spinner line
    $blank = " " * ($Message.Length + 12)
    Write-Host "`r$blank`r" -NoNewline

    return ($proc.ExitCode -eq 0)
}

Write-Host ""
Write-Host "  OpenAgents Installer  v$VERSION" -ForegroundColor White
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

# =========================================================================
# Step 1: Python
# =========================================================================
Write-Step "Checking Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+..."

function Find-Python {
    foreach ($cmd in @("python3", "python", "py")) {
        try {
            $version = & $cmd --version 2>$null
            if ($version -match "Python (\d+)\.(\d+)\.(\d+)") {
                $major = [int]$matches[1]
                $minor = [int]$matches[2]
                $micro = [int]$matches[3]
                if (($major -gt $MIN_PYTHON_MAJOR) -or (($major -eq $MIN_PYTHON_MAJOR) -and ($minor -ge $MIN_PYTHON_MINOR))) {
                    return @{
                        Command = $cmd
                        Version = "$major.$minor.$micro"
                    }
                }
            }
        } catch { continue }
    }
    return $null
}

$Python = Find-Python
if ($Python) {
    Write-Ok "Python $($Python.Version) ($($Python.Command))"
} else {
    Write-Warn "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ not found - attempting install..."

    $pythonUrl = "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"
    $installerPath = "$env:TEMP\python-installer.exe"

    try {
        Write-Info "Downloading Python installer..."
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $pythonUrl -OutFile $installerPath -UseBasicParsing
        $ProgressPreference = 'Continue'
        Write-Info "Installing Python..."
        Start-Process -FilePath $installerPath -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1" -Wait
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Fail "Cannot install Python. Please install from https://www.python.org/downloads/"
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    $Python = Find-Python
    if ($Python) {
        Write-Ok "Python $($Python.Version) installed"
    } else {
        Write-Fail "Python installation failed. Please install from https://www.python.org/downloads/"
    }
}

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
Write-Step "Installing OpenAgents CLI..."

$PythonCmd = $Python.Command
$PythonPath = (Get-Command $PythonCmd -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) { $PythonPath = $PythonCmd }

$currentVersion = $null
try {
    $currentVersion = & $PythonCmd -c "from openagents import __version__; print(__version__)" 2>$null
} catch {}

$installed = $false

if ($currentVersion) {
    Write-Ok "openagents already installed (v${currentVersion})"
    # Quick check: is there a newer version? Use pip index to avoid slow dependency resolution
    $latestVersion = $null
    try {
        $pipOutput = & $PythonCmd -m pip index versions openagents 2>$null | Select-Object -First 1
        if ($pipOutput -match "\(([^)]+)\)") { $latestVersion = $matches[1] }
    } catch {}

    if ($latestVersion -and $latestVersion -ne $currentVersion) {
        Write-Info "Upgrading v${currentVersion} -> v${latestVersion}..."
        # Show pip's native progress (don't hide behind spinner)
        & $PythonCmd -m pip install --upgrade openagents 2>&1
        if ($LASTEXITCODE -eq 0) { $installed = $true }
        if (-not $installed) {
            & $PythonCmd -m pip install --user --upgrade openagents 2>&1
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        }
    } else {
        Write-Ok "Already up to date"
        $installed = $true
    }
} else {
    # Fresh install — always use --upgrade in case a stale system-level install exists
    Write-Info "Downloading and installing..."
    & $PythonCmd -m pip install --upgrade openagents 2>&1
    if ($LASTEXITCODE -eq 0) { $installed = $true }
    if (-not $installed) {
        & $PythonCmd -m pip install --user --upgrade openagents 2>&1
        if ($LASTEXITCODE -eq 0) { $installed = $true }
    }
}

if ($installed) {
    try {
        $newVersion = & $PythonCmd -c "from openagents import __version__; print(__version__)" 2>$null
    } catch {
        $newVersion = "unknown"
    }
    Write-Ok "openagents v${newVersion} installed"
} else {
    Write-Fail "Failed to install openagents. Try: pip install openagents"
}

# =========================================================================
# Step 3: Ensure openagents is on PATH
# =========================================================================
if (-not (Get-Command openagents -ErrorAction SilentlyContinue)) {
    $scriptsDir = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
    $userScripts = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))" 2>$null

    foreach ($dir in @($scriptsDir, $userScripts)) {
        if ($dir -and (Test-Path "$dir\openagents.exe")) {
            $env:Path = "$dir;$env:Path"
            $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
            if ($userPath -notlike "*$dir*") {
                [System.Environment]::SetEnvironmentVariable("Path", "$dir;$userPath", "User")
                Write-Ok "Added $dir to user PATH (persistent)"
            }
            break
        }
    }
}

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Ok "openagents CLI is ready"
} else {
    Write-Warn "openagents installed but not found on PATH"
    Write-Warn "Restart your terminal, or run: $PythonCmd -m openagents"
}

# =========================================================================
# Done
# =========================================================================
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Run " -NoNewline
Write-Host "openagents" -ForegroundColor White -NoNewline
Write-Host " to:"
Write-Host "    - Install AI agents (Claude, OpenClaw, Codex, Aider, ...)"
Write-Host "    - Manage and configure agents"
Write-Host "    - Connect agents to OpenAgents Workspaces"
Write-Host ""

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Write-Step "Launching OpenAgents..."
    Write-Host ""
    & openagents
}
