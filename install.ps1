# =============================================================================
# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex
#
# Installs the OpenAgents CLI, detects local AI agents, and gets you running.
# Requires PowerShell 5.1+ (built into Windows 10/11).
# =============================================================================

$ErrorActionPreference = "Stop"
$VERSION = "0.8.6"
$MIN_PYTHON_MAJOR = 3
$MIN_PYTHON_MINOR = 10

# --- Helpers ---
function Info($msg)  { Write-Host ">>> " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Ok($msg)    { Write-Host " +  " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Warn($msg)  { Write-Host " !  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Fail($msg)  { Write-Host " X  " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }
function Step($msg)  { Write-Host ""; Info $msg }

# --- Header ---
Write-Host ""
Write-Host "  OpenAgents Installer" -ForegroundColor White -NoNewline
Write-Host "  v$VERSION" -ForegroundColor DarkGray
Write-Host "  Multi-agent orchestration for your local machine" -ForegroundColor DarkGray
Write-Host ""

# =========================================================================
# Step 1: Python
# =========================================================================
Step "Checking Python $MIN_PYTHON_MAJOR.$MIN_PYTHON_MINOR+..."

function Find-Python {
    foreach ($cmd in @("python", "python3", "py")) {
        $exe = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($exe) {
            try {
                $ver = & $exe.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
                $major = & $exe.Source -c "import sys; print(sys.version_info.major)" 2>$null
                $minor = & $exe.Source -c "import sys; print(sys.version_info.minor)" 2>$null
                if ([int]$major -ge $MIN_PYTHON_MAJOR -and [int]$minor -ge $MIN_PYTHON_MINOR) {
                    return @{ Path = $exe.Source; Version = $ver }
                }
            } catch {}
        }
    }
    return $null
}

$python = Find-Python

if ($python) {
    Ok "Python $($python.Version) ($($python.Path))"
} else {
    Warn "Python $MIN_PYTHON_MAJOR.$MIN_PYTHON_MINOR+ not found - attempting install..."

    $installed = $false

    # Try winget first (Windows 10+)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Info "Installing Python via winget..."
        try {
            winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements 2>$null
            $installed = $true
        } catch {
            Warn "winget install failed, trying alternatives..."
        }
    }

    # Try Chocolatey
    if (-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Info "Installing Python via Chocolatey..."
        try {
            choco install python --version=3.12 -y 2>$null
            $installed = $true
        } catch {
            Warn "Chocolatey install failed..."
        }
    }

    # Try Scoop
    if (-not $installed -and (Get-Command scoop -ErrorAction SilentlyContinue)) {
        Info "Installing Python via Scoop..."
        try {
            scoop install python 2>$null
            $installed = $true
        } catch {
            Warn "Scoop install failed..."
        }
    }

    if ($installed) {
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    $python = Find-Python
    if ($python) {
        Ok "Python $($python.Version) installed"
    } else {
        Fail "Python installation did not succeed.`n  Please install Python $MIN_PYTHON_MAJOR.$MIN_PYTHON_MINOR+ from: https://www.python.org/downloads/"
    }
}

$PYTHON = $python.Path

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
Step "Installing OpenAgents CLI..."

# Check if already installed
try {
    $current = & $PYTHON -c "from openagents import __version__; print(__version__)" 2>$null
    if ($current) {
        Ok "openagents already installed (v$current)"
        Info "Upgrading to latest..."
    }
} catch {}

# Install
$installed = $false
try {
    & $PYTHON -m pip install --quiet --upgrade openagents 2>$null
    $installed = $true
} catch {}

if (-not $installed) {
    try {
        & $PYTHON -m pip install --quiet --upgrade --user openagents 2>$null
        $installed = $true
    } catch {}
}

if ($installed) {
    $newVersion = & $PYTHON -c "from openagents import __version__; print(__version__)" 2>$null
    Ok "openagents v$newVersion installed"
} else {
    Fail "Failed to install openagents.`n  Try manually: pip install openagents"
}

# Ensure openagents is on PATH
$oaCmd = Get-Command openagents -ErrorAction SilentlyContinue
if (-not $oaCmd) {
    # Check common locations
    $scriptsDir = & $PYTHON -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
    $userScripts = & $PYTHON -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))" 2>$null

    foreach ($dir in @($scriptsDir, $userScripts)) {
        if ($dir -and (Test-Path "$dir\openagents.exe")) {
            $env:Path = "$dir;$env:Path"
            Warn "Added $dir to PATH for this session"
            Warn "To make permanent, add to your PATH in System Settings"
            break
        }
    }
}

if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Ok "openagents CLI is ready"
} else {
    Warn "openagents installed but not found on PATH"
    Warn "You may need to restart your terminal"
}

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
Step "Detecting local AI agents..."

$agentCount = 0

# Claude Code
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $claudeVer = & claude --version 2>$null | Select-Object -First 1
    Ok "Claude Code ($claudeVer)"
    $agentCount++
} else {
    Write-Host "  Claude Code - not installed" -ForegroundColor DarkGray
}

# OpenAI Codex
if (Get-Command codex -ErrorAction SilentlyContinue) {
    Ok "OpenAI Codex CLI"
    $agentCount++
} else {
    Write-Host "  OpenAI Codex - not installed" -ForegroundColor DarkGray
}

# Aider
if (Get-Command aider -ErrorAction SilentlyContinue) {
    Ok "Aider"
    $agentCount++
} else {
    Write-Host "  Aider - not installed" -ForegroundColor DarkGray
}

# Goose
if (Get-Command goose -ErrorAction SilentlyContinue) {
    Ok "Goose"
    $agentCount++
} else {
    Write-Host "  Goose - not installed" -ForegroundColor DarkGray
}

if ($agentCount -eq 0) {
    Write-Host ""
    Warn "No AI agents found. Install one to get started:"
    Write-Host ""
    Write-Host "  Claude Code" -ForegroundColor White -NoNewline
    Write-Host "  (recommended)" -ForegroundColor DarkGray
    Write-Host "    npm install -g @anthropic-ai/claude-code"
    Write-Host ""
    Write-Host "  OpenAI Codex" -ForegroundColor White
    Write-Host "    npm install -g @openai/codex"
    Write-Host ""
    Write-Host "  Aider" -ForegroundColor White
    Write-Host "    pip install aider-chat"
    Write-Host ""
}

# =========================================================================
# Step 4: Run scan (if CLI is available)
# =========================================================================
if (Get-Command openagents -ErrorAction SilentlyContinue) {
    Step "Running agent scan..."
    Write-Host ""
    try { & openagents 2>$null } catch {}
}

# =========================================================================
# Done
# =========================================================================
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""

if ($agentCount -gt 0) {
    Write-Host "  Quick start:"
    Write-Host ""
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Host "    openagents start claude" -ForegroundColor White -NoNewline
        Write-Host "    Start a Claude agent" -ForegroundColor DarkGray
    } elseif (Get-Command codex -ErrorAction SilentlyContinue) {
        Write-Host "    openagents start codex" -ForegroundColor White -NoNewline
        Write-Host "    Start a Codex agent" -ForegroundColor DarkGray
    }
    Write-Host "    openagents" -ForegroundColor White -NoNewline
    Write-Host "                Show all agents & status" -ForegroundColor DarkGray
    Write-Host ""
} else {
    Write-Host "  Next steps:"
    Write-Host ""
    Write-Host "    1. Install an AI agent (e.g. Claude Code):"
    Write-Host "       openagents install claude" -ForegroundColor White
    Write-Host ""
    Write-Host "    2. Start it:"
    Write-Host "       openagents start claude" -ForegroundColor White
    Write-Host ""
}
