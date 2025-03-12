# Changelog

All notable changes to the OpenAgents project will be documented in this file.

## [0.3.0] - 2024-03-12

### Added
- End-to-end file transfer testing
- Improved network launcher with proper signal handling for graceful shutdown
- Timeout handling for tests to prevent hanging

### Changed
- Updated network_launcher.py to use modern websockets API
- Replaced Agent with AgentAdapter in imports
- Updated protocol instantiation to use correct classes

### Fixed
- Fixed signal handling in network launcher to properly handle Ctrl+C
- Improved cleanup in tests to prevent hanging
- Enhanced error handling during agent disconnection

## [0.2.0] - Previous Release

Initial public release of the OpenAgents framework. 