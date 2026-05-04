# Changelog

All notable changes to the OpenAgents project will be documented in this file.

## [0.6.9] - 2026-04-24

### Added
- Complete local workspace integration (Frontend & Backend run locally)
- Configurable Workspace Endpoint within the Launcher Settings UI
- Hot-reloading of the AgentConnector when the Workspace Endpoint is changed
- `dev-local-frontend` and `dev-local-backend` Makefile targets

### Fixed
- Fixed Alembic migration `005` incorrect PostgreSQL UUID type usage
- Mapped local frontend routing `http://localhost:3001` when workspace endpoint targets localhost

## [0.6.8] - 2025-10-09

### Changed

### Fixed
- Agent start with network id will now use the discovery server to find the network details
