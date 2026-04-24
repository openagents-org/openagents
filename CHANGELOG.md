# Changelog

All notable changes to the OpenAgents project will be documented in this file.

## [Unreleased]

### Added
- Implemented workspace deletion feature in Launcher (UI and IPC) to remove local configurations and perform remote soft-deletion.
- Added `deleteWorkspace` method to `WorkspaceClient` to handle backend soft-delete API.
- Added fallback logic in `loadCore` within `AgentManager` to prioritize local source `agent-connector` during development to prevent dependency caching issues.

### Changed

### Fixed
- Agent start with network id will now use the discovery server to find the network details
