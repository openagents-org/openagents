# =============================================================================
# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex
#
# Installs the OpenAgents CLI (openagents), detects local AI agents,
# and tells the user how to get started.
# =============================================================================

$ErrorActionPreference = "Stop"
$VERSION = "1.0.5"
$NPM_PACKAGE = "@openagents-org/agent-launcher"
$MIN_NODE_MAJOR = 18

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
# Step 1: Node.js
# =========================================================================
Step "Checking Node.js $MIN_NODE_MAJOR+..."

function Find-Node {
    $exe = Get-Command node -ErrorAction SilentlyContinue
    if ($exe) {
        try {
            $ver = & $exe.Source --version 2>$null
            $major = [int]($ver -replace '^v','').Split('.')[0]
            if ($major -ge $MIN_NODE_MAJOR) {
                return @{ Path = $exe.Source; Version = $ver }
            }
        } catch {}
    }
    # Check bundled Node.js
    $bundled = Join-Path $env:USERPROFILE ".openagents\nodejs\node.exe"
    if (Test-Path $bundled) {
        $ver = & $bundled --version 2>$null
        return @{ Path = $bundled; Version = $ver }
    }
    return $null
}

$node = Find-Node
if ($node) {
    Ok "Node.js $($node.Version) ($($node.Path))"
} else {
    Warn "Node.js $MIN_NODE_MAJOR+ not found - installing portable Node.js..."

    $nodeVersion = "v22.16.0"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $url = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-$arch.zip"
    $zipPath = Join-Path $env:TEMP "node-$nodeVersion.zip"
    $nodejsDir = Join-Path $env:USERPROFILE ".openagents\nodejs"

    Info "Downloading $url..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    Info "Extracting to $nodejsDir..."
    New-Item -ItemType Directory -Force -Path $nodejsDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $nodejsDir -Force

    # Move contents from nested folder
    $nested = Get-ChildItem $nodejsDir -Directory | Where-Object { $_.Name -like "node-*" } | Select-Object -First 1
    if ($nested) {
        Get-ChildItem $nested.FullName | Move-Item -Destination $nodejsDir -Force -ErrorAction SilentlyContinue
        Remove-Item $nested.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    # Add to PATH for this session
    $env:PATH = "$nodejsDir;$env:PATH"

    $node = Find-Node
    if ($node) {
        Ok "Node.js $($node.Version) installed (portable)"
    } else {
        Fail "Node.js installation failed. Please install from https://nodejs.org"
    }
}

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
Step "Installing OpenAgents CLI..."

# Find npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $bundledNpm = Join-Path $env:USERPROFILE ".openagents\nodejs\npm.cmd"
    if (Test-Path $bundledNpm) {
        $env:PATH = (Join-Path $env:USERPROFILE ".openagents\nodejs") + ";$env:PATH"
    }
}

# Check if already installed (ignore old Python openagents)
$existing = Get-Command openagents -ErrorAction SilentlyContinue
if ($existing) {
    $currentVer = cmd /c "openagents --version 2>nul" 2>$null
    if ($currentVer -and "$currentVer" -match 'agent-launcher|agent-connector') {
        Ok "openagents already installed ($currentVer)"
        Info "Upgrading to latest..."
    }
}

# Install globally
# Install to ~/.openagents/nodejs/node_modules/ (consistent across all platforms)
$prefixDir = Join-Path $env:USERPROFILE ".openagents\nodejs"
# Install via direct tarball (avoids npm --prefix pruning other packages)
$coreDir = Join-Path $prefixDir "node_modules\@openagents-org\agent-launcher"
$latestVer = & npm view "$NPM_PACKAGE" version 2>$null
$installedVer = ""
$corePkg = Join-Path $coreDir "package.json"
if (Test-Path $corePkg) {
    $installedVer = (Get-Content $corePkg | ConvertFrom-Json).version
}

if ($latestVer -and ($latestVer -ne $installedVer)) {
    $tarballUrl = "https://registry.npmjs.org/$NPM_PACKAGE/-/agent-launcher-$latestVer.tgz"
    $tgz = Join-Path $env:TEMP "agent-launcher.tgz"
    Invoke-WebRequest -Uri $tarballUrl -OutFile $tgz -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $coreDir | Out-Null
    tar -xzf $tgz -C $coreDir --strip-components=1
    Remove-Item $tgz -Force -ErrorAction SilentlyContinue
    # Install blessed (TUI dep) via direct tarball — avoids npm --prefix pruning other packages
    $blessedDir = Join-Path $prefixDir "node_modules\blessed"
    if (-not (Test-Path (Join-Path $blessedDir "package.json"))) {
        $blessedVer = & npm view blessed version 2>$null
        if (-not $blessedVer) { $blessedVer = "0.1.81" }
        $blessedTgz = Join-Path $env:TEMP "blessed.tgz"
        Invoke-WebRequest -Uri "https://registry.npmjs.org/blessed/-/blessed-$blessedVer.tgz" -OutFile $blessedTgz -UseBasicParsing
        New-Item -ItemType Directory -Force -Path $blessedDir | Out-Null
        tar -xzf $blessedTgz -C $blessedDir --strip-components=1
        Remove-Item $blessedTgz -Force -ErrorAction SilentlyContinue
    }
    # Create bin shims
    $shimDir = Join-Path $prefixDir "node_modules\.bin"
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
    $nodeExePath = if (Test-Path (Join-Path $prefixDir "node.exe")) { Join-Path $prefixDir "node.exe" } else { "node" }
    $cliJs = Join-Path $coreDir "bin\agent-connector.js"
    foreach ($name in @("openagents", "agent-connector")) {
        Set-Content -Path (Join-Path $shimDir "$name.cmd") -Value "@echo off`r`n`"$nodeExePath`" `"$cliJs`" %*`r`n"
    }
    Ok "$NPM_PACKAGE v$latestVer installed"
} elseif ($installedVer) {
    Ok "Already up to date ($installedVer)"
}

$env:PATH = "$prefixDir\node_modules\.bin;$prefixDir;$env:PATH"

# Ensure node.exe is at ~/.openagents/nodejs/ (unified path for the daemon)
# If we used system node (not portable), copy it so the daemon can find it
$portableNode = Join-Path $prefixDir "node.exe"
if (-not (Test-Path $portableNode)) {
    $systemNode = $node.Path
    if ($systemNode -and (Test-Path $systemNode)) {
        Copy-Item $systemNode $portableNode -Force
    }
}

# Verify
$oaBin = ""
$acCmd = Get-Command openagents -ErrorAction SilentlyContinue
if ($acCmd) {
    # Read version from package.json (more reliable than running --version via shim)
    $newVer = ""
    try { $newVer = (Get-Content $corePkg -ErrorAction SilentlyContinue | ConvertFrom-Json).version } catch {}
    if (-not $newVer) { $newVer = if ($latestVer) { $latestVer } else { $installedVer } }
    $oaBin = $acCmd.Source
    Ok "openagents v$newVer installed"
} else {
    Fail "Failed to install openagents. Try: npm install -g $NPM_PACKAGE"
}

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
Step "Detecting local AI agents..."

$agentCount = 0

function Detect-Agent($name, $binary) {
    $cmd = Get-Command $binary -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = try { & $binary --version 2>$null | Select-Object -First 1 } catch { "" }
        if ($ver) { Ok "$name ($ver)" } else { Ok $name }
        $script:agentCount++
    } else {
        Write-Host "  $name - not installed" -ForegroundColor DarkGray
    }
}

Detect-Agent "Claude Code"    "claude"
Detect-Agent "OpenClaw"       "openclaw"
Detect-Agent "OpenAI Codex"   "codex"
Detect-Agent "Aider"          "aider"
Detect-Agent "Goose"          "goose"
Detect-Agent "Gemini CLI"     "gemini"
Detect-Agent "Copilot CLI"    "copilot"
Detect-Agent "Amp"            "amp"
Detect-Agent "OpenCode"       "opencode"

# =========================================================================
# Done
# =========================================================================
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""

# Auto-configure PATH if needed
$needsPath = @()
# Check if openagents bin dir is on user PATH
if ($oaBin) {
    $oaDir = Split-Path $oaBin
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$oaDir*") {
        $needsPath += $oaDir
    }
}
# Check if portable nodejs needs to be on PATH
$nodejsDir = Join-Path $env:USERPROFILE ".openagents\nodejs"
if (Test-Path (Join-Path $nodejsDir "node.exe")) {
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$nodejsDir*") {
        $needsPath += $nodejsDir
    }
}

if ($needsPath.Count -gt 0) {
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $additions = ($needsPath -join ";")
    if ($userPath) {
        $newPath = "$additions;$userPath"
    } else {
        $newPath = $additions
    }
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    # Also update current session
    $env:PATH = "$additions;$env:PATH"
    Ok "PATH configured for: $($needsPath -join ', ')"
    Write-Host "  Restart your terminal for PATH changes to take effect." -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host "  Get started:" -ForegroundColor White
Write-Host ""
Write-Host "    openagents" -ForegroundColor White -NoNewline
Write-Host "                  Launch the interactive dashboard"
Write-Host ""

if ($agentCount -eq 0) {
    Write-Host "  No AI agents found. The dashboard will help you install one." -ForegroundColor DarkGray
    Write-Host ""
}
