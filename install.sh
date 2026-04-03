#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OpenAgents Installer
# Usage: curl -fsSL https://openagents.org/install.sh | bash
#
# Installs the OpenAgents CLI (openagents), detects local AI agents,
# and tells the user how to get started.
# =============================================================================

# Redirect all output to stderr so it's visible even when piped (curl | bash)
exec 3>&1 1>&2

# Save original PATH to detect if openagents needs PATH setup
ORIGINAL_PATH="$PATH"

VERSION="1.0.6"
NPM_PACKAGE="@openagents-org/agent-launcher"
MIN_NODE_MAJOR=18

# --- Colors (safe for pipes) ---
if [ -t 2 ] && command -v tput >/dev/null 2>&1; then
    BOLD=$(tput bold 2>/dev/null || true)
    GREEN=$(tput setaf 2 2>/dev/null || true)
    YELLOW=$(tput setaf 3 2>/dev/null || true)
    RED=$(tput setaf 1 2>/dev/null || true)
    CYAN=$(tput setaf 6 2>/dev/null || true)
    DIM=$(tput dim 2>/dev/null || true)
    RESET=$(tput sgr0 2>/dev/null || true)
else
    BOLD="" GREEN="" YELLOW="" RED="" CYAN="" DIM="" RESET=""
fi

info()  { echo "${BOLD}${CYAN}>>>${RESET} $*"; }
ok()    { echo "${BOLD}${GREEN} +${RESET} $*"; }
warn()  { echo "${BOLD}${YELLOW} !${RESET} $*"; }
fail()  { echo "${BOLD}${RED} X${RESET} $*"; exit 1; }
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
# Step 1: Node.js
# =========================================================================
step "Checking Node.js ${MIN_NODE_MAJOR}+..."

find_node() {
    for cmd in node nodejs; do
        if command -v "$cmd" >/dev/null 2>&1; then
            major=$("$cmd" -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo 0)
            if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
                echo "$cmd"
                return 0
            fi
        fi
    done
    return 1
}

NODE=""
if NODE=$(find_node); then
    node_version=$($NODE --version)
    ok "Node.js $node_version ($NODE)"
else
    warn "Node.js ${MIN_NODE_MAJOR}+ not found — installing..."

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "Installing Node.js via Homebrew..."
                brew install node 2>/dev/null || true
            fi
            if ! command -v node >/dev/null 2>&1; then
                info "Downloading Node.js portable..."
                if [ "$ARCH" = "arm64" ]; then
                    NODE_URL="https://nodejs.org/dist/v22.16.0/node-v22.16.0-darwin-arm64.tar.gz"
                else
                    NODE_URL="https://nodejs.org/dist/v22.16.0/node-v22.16.0-darwin-x64.tar.gz"
                fi
                mkdir -p "$HOME/.openagents/nodejs"
                curl -fsSL "$NODE_URL" | tar xz -C "$HOME/.openagents/nodejs" --strip-components=1
                export PATH="$HOME/.openagents/nodejs/bin:$PATH"
            fi
            ;;
        linux)
            if command -v apt-get >/dev/null 2>&1; then
                info "Installing Node.js via apt..."
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>/dev/null || true
                sudo apt-get install -y -qq nodejs 2>/dev/null || true
            elif command -v dnf >/dev/null 2>&1; then
                info "Installing Node.js via dnf..."
                sudo dnf install -y nodejs 2>/dev/null || true
            else
                info "Downloading Node.js portable..."
                NODE_URL="https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz"
                mkdir -p "$HOME/.openagents/nodejs"
                curl -fsSL "$NODE_URL" | tar xJ -C "$HOME/.openagents/nodejs" --strip-components=1
                export PATH="$HOME/.openagents/nodejs/bin:$PATH"
            fi
            ;;
        windows)
            fail "On Windows, please install Node.js from https://nodejs.org or use install.ps1"
            ;;
        *)
            fail "Unsupported OS. Please install Node.js ${MIN_NODE_MAJOR}+ manually: https://nodejs.org"
            ;;
    esac

    if NODE=$(find_node); then
        node_version=$($NODE --version)
        ok "Node.js $node_version installed"
    else
        fail "Node.js installation did not succeed.
  Please install Node.js ${MIN_NODE_MAJOR}+ manually: https://nodejs.org"
    fi
fi

# Ensure portable Node.js v22+ at ~/.openagents/nodejs/bin/ for agents that need it
# (e.g. OpenClaw requires v22.12+). System Node may be older (v18/v20).
PORTABLE_NODE="$HOME/.openagents/nodejs/bin/node"
PORTABLE_NODE_VER="v22.16.0"
if [ -x "$PORTABLE_NODE" ]; then
    portable_major=$("$PORTABLE_NODE" -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo 0)
    if [ "$portable_major" -lt 22 ]; then
        info "Upgrading portable Node.js to $PORTABLE_NODE_VER..."
        _install_portable=1
    fi
elif [ ! -x "$PORTABLE_NODE" ]; then
    _install_portable=1
fi

if [ "${_install_portable:-}" = "1" ]; then
    case "$OS" in
        macos)
            if [ "$ARCH" = "arm64" ]; then
                _PNODE_URL="https://nodejs.org/dist/$PORTABLE_NODE_VER/node-${PORTABLE_NODE_VER}-darwin-arm64.tar.gz"
            else
                _PNODE_URL="https://nodejs.org/dist/$PORTABLE_NODE_VER/node-${PORTABLE_NODE_VER}-darwin-x64.tar.gz"
            fi
            mkdir -p "$HOME/.openagents/nodejs"
            curl -fsSL "$_PNODE_URL" | tar xz -C "$HOME/.openagents/nodejs" --strip-components=1
            ;;
        linux)
            _PNODE_URL="https://nodejs.org/dist/$PORTABLE_NODE_VER/node-${PORTABLE_NODE_VER}-linux-x64.tar.xz"
            mkdir -p "$HOME/.openagents/nodejs"
            curl -fsSL "$_PNODE_URL" | tar xJ -C "$HOME/.openagents/nodejs" --strip-components=1
            ;;
    esac
    if [ -x "$PORTABLE_NODE" ]; then
        ok "Portable Node.js $PORTABLE_NODE_VER installed"
    fi
fi
export PATH="$HOME/.openagents/nodejs/bin:$PATH"

# =========================================================================
# Step 2: Install/upgrade openagents
# =========================================================================
step "Installing OpenAgents CLI..."

NPM="npm"
if ! command -v npm >/dev/null 2>&1; then
    # Try common locations
    for d in "$HOME/.openagents/nodejs/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
        if [ -x "$d/npm" ]; then
            NPM="$d/npm"
            break
        fi
    done
fi

# Check if already installed
if command -v openagents >/dev/null 2>&1; then
    current=$(openagents --version 2>/dev/null | head -1 || echo "unknown")
    ok "openagents already installed ($current)"
    info "Upgrading to latest..."
fi

# Install to ~/.openagents/nodejs/node_modules/ via direct tarball (avoids npm --prefix pruning)
PREFIX_DIR="$HOME/.openagents/nodejs"
CORE_DIR="$PREFIX_DIR/node_modules/@openagents-org/agent-launcher"
LATEST_VER=$($NPM view "$NPM_PACKAGE" version 2>/dev/null || echo "")
INSTALLED_VER=""
if [ -f "$CORE_DIR/package.json" ]; then
    INSTALLED_VER=$(node -e "try{console.log(require('$CORE_DIR/package.json').version)}catch{}" 2>/dev/null || echo "")
fi

if [ -n "$LATEST_VER" ] && [ "$LATEST_VER" != "$INSTALLED_VER" ]; then
    TARBALL_URL="https://registry.npmjs.org/$NPM_PACKAGE/-/agent-launcher-${LATEST_VER}.tgz"
    mkdir -p "$CORE_DIR"
    curl -fsSL "$TARBALL_URL" | tar xz -C "$CORE_DIR" --strip-components=1
    # Install blessed (TUI dep) via direct tarball — avoids npm --prefix pruning other packages
    BLESSED_DIR="$PREFIX_DIR/node_modules/blessed"
    if [ ! -f "$BLESSED_DIR/package.json" ]; then
        BLESSED_VER=$($NPM view blessed version 2>/dev/null || echo "0.1.81")
        mkdir -p "$BLESSED_DIR"
        curl -fsSL "https://registry.npmjs.org/blessed/-/blessed-${BLESSED_VER}.tgz" | tar xz -C "$BLESSED_DIR" --strip-components=1
    fi
    # Create package.json at prefix so future npm --save --prefix installs don't prune core packages
    if [ ! -f "$PREFIX_DIR/package.json" ]; then
        printf '{"private":true,"dependencies":{"%s":"%s","blessed":"%s"}}\n' \
            "$NPM_PACKAGE" "$LATEST_VER" "${BLESSED_VER:-0.1.81}" > "$PREFIX_DIR/package.json"
    else
        # Update existing package.json to include core deps
        node -e "
            const f='$PREFIX_DIR/package.json';
            const p=JSON.parse(require('fs').readFileSync(f,'utf-8'));
            p.dependencies=p.dependencies||{};
            p.dependencies['$NPM_PACKAGE']='$LATEST_VER';
            if(!p.dependencies.blessed)p.dependencies.blessed='${BLESSED_VER:-0.1.81}';
            require('fs').writeFileSync(f,JSON.stringify(p));
        " 2>/dev/null
    fi
    # Create bin shims (tarball install doesn't create .bin entries)
    BIN_SHIM_DIR="$PREFIX_DIR/node_modules/.bin"
    mkdir -p "$BIN_SHIM_DIR"
    for name in agn openagents agent-connector; do
        printf '#!/bin/sh\nexec "$(dirname "$0")/../../bin/node" "$(dirname "$0")/../@openagents-org/agent-launcher/bin/agent-connector.js" "$@"\n' > "$BIN_SHIM_DIR/$name"
        chmod +x "$BIN_SHIM_DIR/$name"
    done
elif [ -n "$INSTALLED_VER" ]; then
    info "Already up to date ($INSTALLED_VER)"
fi

# Portable node at ~/.openagents/nodejs/bin/ is always installed above.
# Ensure npm is also available there (tarball includes it).
BIN_DIR="$PREFIX_DIR/bin"
if [ ! -x "$BIN_DIR/npm" ] && [ -x "$BIN_DIR/node" ]; then
    # Portable tarball should include npm; if not, symlink system npm
    SYSTEM_NPM=$(command -v npm 2>/dev/null)
    if [ -n "$SYSTEM_NPM" ]; then
        ln -sf "$SYSTEM_NPM" "$BIN_DIR/npm"
    fi
fi

export PATH="$PREFIX_DIR/node_modules/.bin:$PREFIX_DIR/bin:$PATH"

OA_BIN=""
if command -v openagents >/dev/null 2>&1; then
    # Use known version (already fetched above) — most reliable
    _oa_ver="${LATEST_VER:-${INSTALLED_VER:-unknown}}"
    OA_BIN=$(command -v openagents)
    ok "openagents v${_oa_ver} installed"
else
    fail "Failed to install openagents.
  Try manually: npm install -g $NPM_PACKAGE"
fi

# =========================================================================
# Step 3: Detect local AI agents
# =========================================================================
step "Detecting local AI agents..."

agent_count=0

detect_agent() {
    local name="$1"
    local binary="$2"
    if command -v "$binary" >/dev/null 2>&1; then
        local ver
        ver=$("$binary" --version 2>/dev/null | head -1 || echo "")
        ok "$name${ver:+ ($ver)}"
        agent_count=$((agent_count + 1))
    else
        echo "  ${DIM}$name — not installed${RESET}"
    fi
}

detect_agent "Claude Code"    claude
detect_agent "OpenClaw"       openclaw
detect_agent "OpenAI Codex"   codex
detect_agent "Aider"          aider
detect_agent "Goose"          goose
detect_agent "Gemini CLI"     gemini
detect_agent "Copilot CLI"    copilot
detect_agent "Amp"            amp
detect_agent "OpenCode"       opencode

# =========================================================================
# Done
# =========================================================================
echo ""
echo "${BOLD}${GREEN}  Installation complete!${RESET}"
echo ""

# Auto-configure PATH if openagents isn't on the user's original PATH
NEEDS_PATH=""
if [ -n "$OA_BIN" ]; then
    OA_DIR=$(dirname "$OA_BIN")
    case ":${ORIGINAL_PATH}:" in
        *":${OA_DIR}:"*) ;;  # already on PATH
        *) NEEDS_PATH="$OA_DIR" ;;
    esac
fi

if [ -n "$NEEDS_PATH" ]; then
    # Include portable nodejs if we installed it
    if [ -d "$HOME/.openagents/nodejs/bin" ]; then
        PATH_LINE="export PATH=\"$HOME/.openagents/nodejs/bin:$NEEDS_PATH:\$PATH\""
    else
        PATH_LINE="export PATH=\"$NEEDS_PATH:\$PATH\""
    fi
    ADDED_TO=""

    # Auto-add to shell profile
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
        if [ -f "$rc" ]; then
            if ! grep -qF "$NEEDS_PATH" "$rc" 2>/dev/null; then
                echo "" >> "$rc"
                echo "# Added by OpenAgents installer" >> "$rc"
                echo "$PATH_LINE" >> "$rc"
                ADDED_TO="$rc"
            else
                ADDED_TO="$rc (already configured)"
            fi
            break
        fi
    done

    # If no rc file found, create .profile
    if [ -z "$ADDED_TO" ]; then
        echo "# Added by OpenAgents installer" > "$HOME/.profile"
        echo "$PATH_LINE" >> "$HOME/.profile"
        ADDED_TO="$HOME/.profile (created)"
    fi

    ok "PATH configured in ${ADDED_TO}"
    echo ""
    echo "  ${DIM}Restart your terminal, or run:${RESET}"
    echo "    ${BOLD}source ${ADDED_TO%% *}${RESET}"
    echo ""
fi

echo "  Get started:"
echo ""
echo "    ${BOLD}agn${RESET}                         Launch the interactive dashboard"
echo ""

if [ "$agent_count" -eq 0 ]; then
    echo "  ${DIM}No AI agents found. The dashboard will help you install one.${RESET}"
    echo ""
fi
