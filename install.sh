#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OpenAgents Installer
# Usage: curl -fsSL https://openagents.org/install.sh | bash
#
# Installs the OpenAgents CLI, detects local AI agents, and gets you running.
# Works on macOS, Linux, and Windows (WSL/Git Bash).
# =============================================================================

VERSION="0.9.0"
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=10

# --- Colors (safe for pipes) ---
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    BOLD=$(tput bold)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    RED=$(tput setaf 1)
    CYAN=$(tput setaf 6)
    DIM=$(tput dim)
    RESET=$(tput sgr0)
else
    BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()  { echo "${BOLD}${CYAN}>>>${RESET} $*"; }
ok()    { echo "${BOLD}${GREEN} ✓${RESET} $*"; }
warn()  { echo "${BOLD}${YELLOW} !${RESET} $*"; }
fail()  { echo "${BOLD}${RED} ✗${RESET} $*"; exit 1; }
step()  { echo ""; info "$*"; }

# --- Header ---
echo ""
echo "${BOLD}  OpenAgents Installer${RESET}  ${DIM}v${VERSION}${RESET}"
echo "${DIM}  Multi-agent orchestration for your local machine${RESET}"
echo ""

# --- Detect OS ---
OS="unknown"
ARCH="$(uname -m)"
case "$(uname -s)" in
    Linux*)   OS="linux";;
    Darwin*)  OS="macos";;
    MINGW*|MSYS*|CYGWIN*) OS="windows";;
esac

# =========================================================================
# Step 1: Python
# =========================================================================
step "Checking Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+..."

find_python() {
    for cmd in python3 python; do
        if command -v "$cmd" >/dev/null 2>&1; then
            major=$("$cmd" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo 0)
            minor=$("$cmd" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo 0)
            if [ "$major" -ge "$MIN_PYTHON_MAJOR" ] && [ "$minor" -ge "$MIN_PYTHON_MINOR" ]; then
                echo "$cmd"
                return 0
            fi
        fi
    done
    return 1
}

PYTHON=""
if PYTHON=$(find_python); then
    py_version=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
    ok "Python $py_version ($PYTHON)"
else
    warn "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ not found — attempting install..."

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "Installing Python via Homebrew..."
                brew install python@3.12 2>/dev/null || true
            else
                info "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                # Add brew to PATH for this session
                if [ -f /opt/homebrew/bin/brew ]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [ -f /usr/local/bin/brew ]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                brew install python@3.12
            fi
            ;;
        linux)
            if command -v apt-get >/dev/null 2>&1; then
                info "Installing Python via apt..."
                sudo apt-get update -qq
                sudo apt-get install -y -qq python3 python3-pip python3-venv
            elif command -v dnf >/dev/null 2>&1; then
                info "Installing Python via dnf..."
                sudo dnf install -y python3 python3-pip
            elif command -v pacman >/dev/null 2>&1; then
                info "Installing Python via pacman..."
                sudo pacman -Sy --noconfirm python python-pip
            elif command -v apk >/dev/null 2>&1; then
                info "Installing Python via apk..."
                sudo apk add python3 py3-pip
            else
                fail "Cannot auto-install Python on this system.
  Please install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ manually:
    https://www.python.org/downloads/"
            fi
            ;;
        windows)
            if command -v winget >/dev/null 2>&1; then
                info "Installing Python via winget..."
                winget install -e --id Python.Python.3.12 --accept-source-agreements 2>/dev/null || true
            elif command -v choco >/dev/null 2>&1; then
                info "Installing Python via Chocolatey..."
                choco install python --version=3.12 -y 2>/dev/null || true
            else
                fail "Cannot auto-install Python on this system.
  Please install Python from: https://www.python.org/downloads/"
            fi
            ;;
        *)
            fail "Unsupported OS. Please install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ manually."
            ;;
    esac

    # Retry finding Python after install
    if PYTHON=$(find_python); then
        py_version=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
        ok "Python $py_version installed"
    else
        fail "Python installation did not succeed.
  Please install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ manually:
    https://www.python.org/downloads/"
    fi
fi

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
step "Installing OpenAgents CLI..."

PIP="$PYTHON -m pip"

# Check if already installed
if $PYTHON -c "import openagents" 2>/dev/null; then
    current=$($PYTHON -c "from openagents import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "openagents already installed (v${current})"
    info "Upgrading to latest..."
fi

# Determine pip flags
PIP_FLAGS="--quiet"
if [ -z "${VIRTUAL_ENV:-}" ]; then
    # Not in a venv — use --user to avoid permission issues
    PIP_FLAGS="$PIP_FLAGS --user"
fi

installed=false
if $PIP install $PIP_FLAGS --upgrade openagents 2>/dev/null; then
    installed=true
elif $PIP install $PIP_FLAGS --upgrade --break-system-packages openagents 2>/dev/null; then
    installed=true
elif $PYTHON -m pip install --quiet --upgrade openagents 2>/dev/null; then
    installed=true
fi

if [ "$installed" = true ]; then
    new_version=$($PYTHON -c "from openagents import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "openagents v${new_version} installed"
else
    fail "Failed to install openagents.
  Try manually: pip install openagents"
fi

# Ensure openagents is on PATH
if ! command -v openagents >/dev/null 2>&1; then
    # Check common locations
    for bin_dir in "$HOME/.local/bin" "$HOME/Library/Python/3.12/bin" "$HOME/Library/Python/3.11/bin"; do
        if [ -f "$bin_dir/openagents" ]; then
            export PATH="$bin_dir:$PATH"
            warn "Added $bin_dir to PATH"
            warn "To make this permanent, add to your shell config:"
            echo "    ${BOLD}export PATH=\"$bin_dir:\$PATH\"${RESET}"
            break
        fi
    done
fi

# Verify CLI works
if command -v openagents >/dev/null 2>&1; then
    ok "openagents CLI is ready"
else
    warn "openagents installed but not found on PATH"
    warn "You may need to restart your terminal or add it to PATH"
fi

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
step "Detecting local AI agents..."

agent_count=0

# Claude Code
if command -v claude >/dev/null 2>&1; then
    claude_ver=$(claude --version 2>/dev/null | head -1 || echo "unknown")
    ok "Claude Code ($claude_ver)"
    agent_count=$((agent_count + 1))
else
    echo "  ${DIM}Claude Code — not installed${RESET}"
fi

# OpenAI Codex
if command -v codex >/dev/null 2>&1; then
    ok "OpenAI Codex CLI"
    agent_count=$((agent_count + 1))
else
    echo "  ${DIM}OpenAI Codex — not installed${RESET}"
fi

# Aider
if command -v aider >/dev/null 2>&1; then
    ok "Aider"
    agent_count=$((agent_count + 1))
else
    echo "  ${DIM}Aider — not installed${RESET}"
fi

# Goose
if command -v goose >/dev/null 2>&1; then
    ok "Goose"
    agent_count=$((agent_count + 1))
else
    echo "  ${DIM}Goose — not installed${RESET}"
fi

if [ "$agent_count" -eq 0 ]; then
    echo ""
    warn "No AI agents found. Install one to get started:"
    echo ""
    echo "  ${BOLD}Claude Code${RESET}  (recommended)"
    echo "    curl -fsSL https://claude.ai/install.sh | bash"
    echo ""
    echo "  ${BOLD}OpenAI Codex${RESET}"
    echo "    npm install -g @openai/codex"
    echo ""
    echo "  ${BOLD}Aider${RESET}"
    echo "    pip install aider-chat"
    echo ""
fi

# =========================================================================
# Step 4: Run scan (if CLI is available)
# =========================================================================
if command -v openagents >/dev/null 2>&1; then
    step "Running agent scan..."
    echo ""
    openagents 2>/dev/null || true
fi

# =========================================================================
# Done
# =========================================================================
echo ""
echo "${BOLD}${GREEN}  Installation complete!${RESET}"
echo ""

if [ "$agent_count" -gt 0 ]; then
    echo "  Quick start:"
    echo ""
    if command -v claude >/dev/null 2>&1; then
        echo "    ${BOLD}openagents start claude${RESET}    Start a Claude agent"
    elif command -v codex >/dev/null 2>&1; then
        echo "    ${BOLD}openagents start codex${RESET}    Start a Codex agent"
    fi
    echo "    ${BOLD}openagents${RESET}                Show all agents & status"
    echo ""
else
    echo "  Next steps:"
    echo ""
    echo "    1. Install an AI agent (e.g. Claude Code):"
    echo "       ${BOLD}openagents install claude${RESET}"
    echo ""
    echo "    2. Start it:"
    echo "       ${BOLD}openagents start claude${RESET}"
    echo ""
fi
