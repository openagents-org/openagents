# =============================================================================
# OpenAgents Installer for Windows
# Usage: irm https://openagents.org/install.ps1 | iex
#
# Installs the OpenAgents CLI (openagents / agn), detects local AI agents,
# and tells the user how to get started.
# =============================================================================

$ErrorActionPreference = "Stop"
$VERSION = "1.0.6"
$NPM_PACKAGE = "@openagents-org/agent-launcher"
$MIN_NODE_MAJOR = 18
$NODE_V22 = "v22.22.3"
$NODE_V22_MIN = [version]"22.19.0"  # Minimum portable Node for agents like OpenClaw (>=22.19)

# --- Helpers ---
function Info($msg)  { Write-Host ">>> " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Ok($msg)    { Write-Host " +  " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Warn($msg)  { Write-Host " !  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Fail($msg)  { Write-Host " X  " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }
function Step($msg)  { Write-Host ""; Info $msg }
function Dim($msg)   { Write-Host "  $msg" -ForegroundColor DarkGray }

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

$nodejsDir = Join-Path $env:USERPROFILE ".openagents\nodejs"

function Find-Node {
    $exe = Get-Command node -ErrorAction SilentlyContinue
    if ($exe) {
        try {
            $ver = & $exe.Source --version 2>$null
            $major = [int]($ver -replace '^v','').Split('.')[0]
            if ($major -ge $MIN_NODE_MAJOR) {
                return @{ Path = $exe.Source; Version = $ver; Major = $major }
            }
        } catch {}
    }
    # Check bundled Node.js
    $bundled = Join-Path $nodejsDir "node.exe"
    if (Test-Path $bundled) {
        try {
            $ver = & $bundled --version 2>$null
            $major = [int]($ver -replace '^v','').Split('.')[0]
            return @{ Path = $bundled; Version = $ver; Major = $major }
        } catch {}
    }
    return $null
}

$node = Find-Node
if ($node) {
    Ok "Node.js $($node.Version) ($($node.Path))"
} else {
    Warn "Node.js $MIN_NODE_MAJOR+ not found - installing portable Node.js..."

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $url = "https://nodejs.org/dist/$NODE_V22/node-$NODE_V22-win-$arch.zip"
    $zipPath = Join-Path $env:TEMP "node-$NODE_V22.zip"

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
# Step 1b: Ensure portable Node.js >=22.19 at ~/.openagents/nodejs/
# Agents like OpenClaw require Node v22.19+. System Node may be v18/v20, or an
# older portable v22 (e.g. v22.16) left by a previous installer version.
# =========================================================================
$portableNode = Join-Path $nodejsDir "node.exe"
$needPortableUpgrade = $false

function Test-NodeBelowMin($verString) {
    try { return ([version]($verString -replace '^v','')) -lt $NODE_V22_MIN } catch { return $true }
}

if (Test-Path $portableNode) {
    try {
        $pVer = & $portableNode --version 2>$null
        if (Test-NodeBelowMin $pVer) {
            Info "Upgrading portable Node.js to $NODE_V22 (current: $pVer, need >=$NODE_V22_MIN)..."
            $needPortableUpgrade = $true
        }
    } catch {
        $needPortableUpgrade = $true
    }
} elseif ($node -and (Test-NodeBelowMin $node.Version)) {
    Info "Installing portable Node.js $NODE_V22 (system Node is $($node.Version), need >=$NODE_V22_MIN)..."
    $needPortableUpgrade = $true
}

if ($needPortableUpgrade) {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $url = "https://nodejs.org/dist/$NODE_V22/node-$NODE_V22-win-$arch.zip"
    $zipPath = Join-Path $env:TEMP "node-$NODE_V22.zip"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    New-Item -ItemType Directory -Force -Path $nodejsDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $nodejsDir -Force

    $nested = Get-ChildItem $nodejsDir -Directory | Where-Object { $_.Name -like "node-*" } | Select-Object -First 1
    if ($nested) {
        Get-ChildItem $nested.FullName | Move-Item -Destination $nodejsDir -Force -ErrorAction SilentlyContinue
        Remove-Item $nested.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    if (Test-Path $portableNode) {
        $pVer = & $portableNode --version 2>$null
        Ok "Portable Node.js $pVer installed"
    }
}

# Ensure portable node is on PATH for this session
if (Test-Path $nodejsDir) {
    if ($env:PATH -notlike "*$nodejsDir*") {
        $env:PATH = "$nodejsDir;$env:PATH"
    }
}

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
Step "Installing OpenAgents CLI..."

# Find npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $bundledNpm = Join-Path $nodejsDir "npm.cmd"
    if (Test-Path $bundledNpm) {
        $env:PATH = "$nodejsDir;$env:PATH"
    }
}

# Ensure npm.cmd exists at portable location (matching launcher pattern)
# Uses %~dp0 relative paths so cmd.exe OEM code page doesn't corrupt non-ASCII home dirs
$npmCmdPath = Join-Path $nodejsDir "npm.cmd"
$npxCmdPath = Join-Path $nodejsDir "npx.cmd"
if ((Test-Path (Join-Path $nodejsDir "node.exe")) -and (-not (Test-Path $npmCmdPath) -or (Get-Item $npmCmdPath).Length -eq 0)) {
    $npmCliJs = Join-Path $nodejsDir "node_modules\npm\bin\npm-cli.js"
    if (Test-Path $npmCliJs) {
        Set-Content -Path $npmCmdPath -Value "@echo off`r`n`"%~dp0node.exe`" `"%~dp0node_modules\npm\bin\npm-cli.js`" %*`r`n" -NoNewline
        Ok "npm.cmd regenerated"
    }
}
if ((Test-Path (Join-Path $nodejsDir "node.exe")) -and (-not (Test-Path $npxCmdPath) -or (Get-Item $npxCmdPath).Length -eq 0)) {
    $npxCliJs = Join-Path $nodejsDir "node_modules\npm\bin\npx-cli.js"
    if (Test-Path $npxCliJs) {
        Set-Content -Path $npxCmdPath -Value "@echo off`r`n`"%~dp0node.exe`" `"%~dp0node_modules\npm\bin\npx-cli.js`" %*`r`n" -NoNewline
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

# Install to ~/.openagents/nodejs/node_modules/ (consistent across all platforms)
$prefixDir = $nodejsDir
# Install via direct tarball (avoids npm --prefix pruning other packages)
$coreDir = Join-Path $prefixDir "node_modules\@openagents-org\agent-launcher"
$latestVer = & npm view "$NPM_PACKAGE" version 2>$null
$installedVer = ""
$corePkg = Join-Path $coreDir "package.json"
if (Test-Path $corePkg) {
    $installedVer = (Get-Content $corePkg -Raw | ConvertFrom-Json).version
}

if ($latestVer -and ($latestVer -ne $installedVer)) {
    $tarballUrl = "https://registry.npmjs.org/$NPM_PACKAGE/-/agent-launcher-$latestVer.tgz"
    $tgz = Join-Path $env:TEMP "agent-launcher.tgz"
    Invoke-WebRequest -Uri $tarballUrl -OutFile $tgz -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $coreDir | Out-Null
    tar -xzf $tgz -C $coreDir --strip-components=1
    Remove-Item $tgz -Force -ErrorAction SilentlyContinue
    # Install blessed (TUI dep) via direct tarball - avoids npm --prefix pruning other packages
    $blessedDir = Join-Path $prefixDir "node_modules\blessed"
    $blessedVer = "0.1.81"
    if (-not (Test-Path (Join-Path $blessedDir "package.json"))) {
        $bv = & npm view blessed version 2>$null
        if ($bv) { $blessedVer = $bv }
        $blessedTgz = Join-Path $env:TEMP "blessed.tgz"
        Invoke-WebRequest -Uri "https://registry.npmjs.org/blessed/-/blessed-$blessedVer.tgz" -OutFile $blessedTgz -UseBasicParsing
        New-Item -ItemType Directory -Force -Path $blessedDir | Out-Null
        tar -xzf $blessedTgz -C $blessedDir --strip-components=1
        Remove-Item $blessedTgz -Force -ErrorAction SilentlyContinue
    }

    # Create package.json at prefix to prevent npm --prefix from pruning core packages
    $prefixPkg = Join-Path $prefixDir "package.json"
    if (-not (Test-Path $prefixPkg)) {
        $pkgJson = @{
            private = $true
            dependencies = @{
                $NPM_PACKAGE = $latestVer
                blessed = $blessedVer
            }
        } | ConvertTo-Json -Compress
        Set-Content -Path $prefixPkg -Value $pkgJson
    } else {
        # Update existing package.json to include core deps
        # Uses Add-Member -Force for PS 5.1 compat (dot-assignment on
        # PSCustomObject silently fails for new properties in 5.1).
        try {
            $pkg = Get-Content $prefixPkg -Raw | ConvertFrom-Json
            if (-not $pkg.dependencies) {
                $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([PSCustomObject]@{}) -Force
            }
            $pkg.dependencies | Add-Member -NotePropertyName $NPM_PACKAGE -NotePropertyValue $latestVer -Force
            $pkg.dependencies | Add-Member -NotePropertyName "blessed" -NotePropertyValue $blessedVer -Force
            $pkg | ConvertTo-Json -Compress | Set-Content -Path $prefixPkg
        } catch {
            Warn "Could not update $prefixPkg - creating fresh"
            $pkgJson = @{
                private = $true
                dependencies = @{
                    $NPM_PACKAGE = $latestVer
                    blessed = $blessedVer
                }
            } | ConvertTo-Json -Compress
            Set-Content -Path $prefixPkg -Value $pkgJson
        }
    }

    # Create bin shims
    # Uses %~dp0-relative paths so cmd.exe OEM code page doesn't corrupt
    # non-ASCII characters in home directory paths (e.g. C:\Users\<non-ascii-name>\...)
    # Matches the launcher's shim format (2-line, no setlocal).
    $shimDir = Join-Path $prefixDir "node_modules\.bin"
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
    foreach ($name in @("agn", "openagents", "agent-connector")) {
        $shimContent = "@echo off`r`n`"%~dp0..\..\node.exe`" `"%~dp0..\@openagents-org\agent-launcher\bin\agent-connector.js`" %*`r`n"
        Set-Content -Path (Join-Path $shimDir "$name.cmd") -Value $shimContent -NoNewline
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
    try { $newVer = (Get-Content $corePkg -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).version } catch {}
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

function Detect-Agent {
    param(
        [string]$Name,
        [string]$Binary,
        [string[]]$ExtraPaths = @()
    )

    $cmd = Get-Command $Binary -ErrorAction SilentlyContinue
    if (-not $cmd) {
        # Check extra paths (e.g. native installer locations not on PATH)
        foreach ($p in $ExtraPaths) {
            if (Test-Path $p) {
                $ver = ""
                # Collect full output before selecting first line; piping a native
                # command straight into Select-Object -First 1 stops the pipeline
                # early, killing the process and leaving $LASTEXITCODE = 255 (which
                # would otherwise become the script's exit code).
                try { $ver = (& $p --version 2>$null) | Select-Object -First 1 } catch {}
                if ($ver) { Ok "$Name ($ver)" } else { Ok "$Name (found at $p)" }
                $script:agentCount++
                return
            }
        }
        Dim "$Name - not installed"
        return
    }
    $ver = try { (& $Binary --version 2>$null) | Select-Object -First 1 } catch { "" }
    if ($ver) { Ok "$Name ($ver)" } else { Ok $Name }
    $script:agentCount++
}

# Build Cursor extra paths (native installer location)
$cursorExtraPaths = @()
if ($env:LOCALAPPDATA) {
    $cursorExtraPaths += Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.cmd"
    $cursorExtraPaths += Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.exe"
}

Detect-Agent -Name "Claude Code"    -Binary "claude"
Detect-Agent -Name "OpenClaw"       -Binary "openclaw"
Detect-Agent -Name "OpenAI Codex"   -Binary "codex"
Detect-Agent -Name "Aider"          -Binary "aider"
Detect-Agent -Name "Goose"          -Binary "goose"
Detect-Agent -Name "Gemini CLI"     -Binary "gemini"
Detect-Agent -Name "Copilot CLI"    -Binary "copilot"
Detect-Agent -Name "Amp"            -Binary "amp"
Detect-Agent -Name "OpenCode"       -Binary "opencode"
Detect-Agent -Name "Hermes Agent"   -Binary "hermes"
Detect-Agent -Name "Cursor"         -Binary "cursor-agent" -ExtraPaths $cursorExtraPaths

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
    Dim "Restart your terminal for PATH changes to take effect."
    Write-Host ""
}

Write-Host "  Get started:" -ForegroundColor White
Write-Host ""
Write-Host "    agn" -ForegroundColor White -NoNewline
Write-Host "                       Launch the interactive dashboard"
Write-Host ""

if ($agentCount -eq 0) {
    Dim "No AI agents found. The dashboard will help you install one."
    Write-Host ""
}
