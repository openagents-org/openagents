#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OpenAgents Installer
# Usage: curl -fsSL https://openagents.org/install.sh | bash
#
# Installs the OpenAgents CLI, detects local AI agents, and gets you running.
# Works on macOS, Linux, and Windows (WSL/Git Bash).
# =============================================================================

VERSION="0.9.3"
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

# Animated spinner for long-running commands
run_with_progress() {
    local msg="$1"
    shift
    local pid
    "$@" >/dev/null 2>&1 &
    pid=$!
    local spinner='|/-\'
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        local char="${spinner:$((i % 4)):1}"
        printf "\r    %s %s..." "$char" "$msg"
        sleep 0.25
        i=$((i + 1))
    done
    printf "\r%*s\r" $((${#msg} + 10)) ""
    wait "$pid"
    return $?
}

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
                run_with_progress "Installing Python via Homebrew" brew install python@3.12 || true
            else
                info "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                # Add brew to PATH for this session
                if [ -f /opt/homebrew/bin/brew ]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [ -f /usr/local/bin/brew ]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                run_with_progress "Installing Python via Homebrew" brew install python@3.12
            fi
            ;;
        linux)
            if command -v apt-get >/dev/null 2>&1; then
                run_with_progress "Updating package index" sudo apt-get update -qq
                run_with_progress "Installing Python" sudo apt-get install -y -qq python3 python3-pip python3-venv
            elif command -v dnf >/dev/null 2>&1; then
                run_with_progress "Installing Python" sudo dnf install -y python3 python3-pip
            elif command -v pacman >/dev/null 2>&1; then
                run_with_progress "Installing Python" sudo pacman -Sy --noconfirm python python-pip
            elif command -v apk >/dev/null 2>&1; then
                run_with_progress "Installing Python" sudo apk add python3 py3-pip
            else
                fail "Cannot auto-install Python on this system.
  Please install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ manually:
    https://www.python.org/downloads/"
            fi
            ;;
        windows)
            if command -v winget >/dev/null 2>&1; then
                run_with_progress "Installing Python via winget" winget install -e --id Python.Python.3.12 --accept-source-agreements || true
            elif command -v choco >/dev/null 2>&1; then
                run_with_progress "Installing Python via Chocolatey" choco install python --version=3.12 -y || true
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

# Determine pip flags (use cache for speed)
PIP_USER_FLAG=""
if [ -z "${VIRTUAL_ENV:-}" ]; then
    PIP_USER_FLAG="--user"
fi

# Check if already installed
installed=false
if $PYTHON -c "import openagents" 2>/dev/null; then
    current=$($PYTHON -c "from openagents import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "openagents already installed (v${current})"
    # Quick check: is there a newer version?
    latest=$($PIP index versions openagents 2>/dev/null | head -1 | sed -n 's/.*(\([^)]*\)).*/\1/p' || echo "")
    if [ -n "$latest" ] && [ "$latest" != "$current" ]; then
        info "Upgrading v${current} -> v${latest}..."
        # Show pip's native progress (don't hide behind spinner)
        if $PIP install $PIP_USER_FLAG --upgrade openagents; then
            installed=true
        elif $PIP install $PIP_USER_FLAG --upgrade --break-system-packages openagents; then
            installed=true
        fi
    else
        ok "Already up to date"
        installed=true
    fi
else
    # Fresh install — always use --upgrade in case a stale system-level install exists
    info "Downloading and installing..."
    if $PIP install $PIP_USER_FLAG --upgrade openagents; then
        installed=true
    elif $PIP install $PIP_USER_FLAG --upgrade --break-system-packages openagents; then
        installed=true
    elif $PYTHON -m pip install --upgrade openagents; then
        installed=true
    fi
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
    warn "Restart your terminal, or run: $PYTHON -m openagents"
fi

# =========================================================================
# Done — launch interactive setup
# =========================================================================
echo ""
echo "${BOLD}${GREEN}  Installation complete!${RESET}"
echo ""
echo "  Run ${BOLD}openagents${RESET} to:"
echo "    - Install AI agents (Claude, OpenClaw, Codex, Aider, ...)"
echo "    - Manage and configure agents"
echo "    - Connect agents to OpenAgents Workspaces"
echo ""

if command -v openagents >/dev/null 2>&1; then
    step "Launching OpenAgents..."
    echo ""
    exec openagents </dev/tty
fi
