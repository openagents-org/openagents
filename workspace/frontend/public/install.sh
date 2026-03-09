#!/usr/bin/env bash
# OpenAgents Workspace Installer
# Redirects to the unified installer at openagents.org
# Usage: curl -fsSL https://workspace.openagents.org/install.sh | bash

exec bash <(curl -fsSL https://openagents.org/install.sh)
