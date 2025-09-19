# Documents Module Test Suite

This directory contains comprehensive test suites for the OpenAgents documents module, including both legacy functionality and new OT (Operational Transformation) collaborative editing features.

## Test Files Overview

### 1. `test_ot_engine.py` - OT Algorithm Unit Tests
**Purpose**: Test the core OT algorithm implementation  
**Coverage**:
- Operation application (insert, delete, retain)
- Operation transformation for conflict resolution
- Operation composition
- Edge cases and error handling

**Key Test Cases**:
- `test_apply_operation_insert()` - Insert operations
- `test_apply_operation_delete()` - Delete operations  
- `test_transform_operation_concurrent_inserts()` - Concurrent insert resolution
- `test_transform_operation_concurrent_deletes()` - Concurrent delete resolution
- `test_compose_operations_simple()` - Operation composition

### 2. `test_documents_ot_collaboration.py` - OT Integration Tests
**Purpose**: Test real-time collaborative editing with multiple clients  
**Coverage**:
- Identity assignment and user management
- Document history synchronization
- Edit operations with conflict resolution
- Cursor and selection synchronization
- Language switching
- Error handling (INVALID_OPERATION, REVISION_MISMATCH, ACCESS_DENIED)

**Key Test Cases**:
- `test_identity_assignment()` - User identity assignment
- `test_history_initialization()` - New user receives complete history
- `test_edit_success()` - Successful edit operations and broadcasting
- `test_edit_revision_mismatch()` - Revision mismatch error handling
- `test_concurrent_edits_ot_resolution()` - OT conflict resolution
- `test_cursor_synchronization()` - Cursor position sync
- `test_language_switching()` - Language change broadcasting
- `test_multi_user_collaboration()` - 3+ user collaboration

### 3. `test_grpc_workspace_documents.py` - Legacy Tests
**Purpose**: Test existing document functionality  
**Coverage**:
- Document creation and management
- Line-based operations
- Comments and presence tracking
- Basic collaboration features

## Running Tests

### Option 1: Run All Tests
```bash
# From project root
python tests/run_documents_tests.py --verbose
```

### Option 2: Run Specific Test Categories
```bash
# Unit tests only
python tests/run_documents_tests.py --unit-only

# Integration tests only  
python tests/run_documents_tests.py --integration-only
```

### Option 3: Run Individual Test Files
```bash
# OT Engine unit tests
python -m pytest tests/mods/test_ot_engine.py -v

# OT Collaboration integration tests
python -m pytest tests/mods/test_documents_ot_collaboration.py -v

# Legacy document tests
python -m pytest tests/mods/test_grpc_workspace_documents.py -v
```

### Option 4: Run Specific Test Cases
```bash
# Run tests matching a pattern
python -m pytest tests/mods/test_documents_ot_collaboration.py -k "identity" -v

# Run a specific test function
python -m pytest tests/mods/test_ot_engine.py::TestOTEngine::test_apply_operation_insert -v
```

## Test Requirements

### Prerequisites
- Python 3.8+
- pytest and pytest-asyncio
- OpenAgents development environment
- Network configuration file (`examples/workspace_test.yaml`)

### Test Environment
Tests use real network infrastructure with:
- Random ports to avoid conflicts
- HTTP transport for client connections
- Temporary test data that's cleaned up automatically
- Isolated test sessions

## Test Architecture

### Fixtures
- `ot_documents_network`: Creates test network with documents mod
- `alice_ot_client`, `bob_ot_client`, `charlie_ot_client`: Test clients with adapters
- Automatic cleanup after each test

### Event Tracking
Tests use event handlers to track:
- History updates
- Identity assignments  
- User info changes
- Cursor updates
- Language changes
- Error events

### Assertions
Tests verify:
- Event message formats and content
- Document state consistency
- Error handling and recovery
- Multi-user synchronization

## Debugging Tests

### Enable Debug Logging
```bash
# Set log level for detailed output
PYTHONPATH=. python -m pytest tests/mods/test_documents_ot_collaboration.py -v -s --log-cli-level=DEBUG
```

### Test Isolation
Each test runs in isolation with:
- Fresh network instance
- Clean document state
- Independent client connections
- Automatic resource cleanup

### Common Issues
1. **Port conflicts**: Tests use random ports, but may still conflict
2. **Timing issues**: Async operations may need longer waits
3. **Network startup**: Allow sufficient time for network initialization
4. **Resource cleanup**: Ensure proper client disconnection

## Adding New Tests

### For OT Algorithm (Unit Tests)
Add to `test_ot_engine.py`:
```python
def test_new_ot_feature(self):
    """Test description."""
    # Test implementation
    assert expected_result == actual_result
```

### For Collaborative Features (Integration Tests)
Add to `test_documents_ot_collaboration.py`:
```python
@pytest.mark.asyncio
async def test_new_collaboration_feature(alice_ot_client, bob_ot_client):
    """Test description."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Test implementation
    assert result["status"] == "success"
```

## Test Coverage Goals

- ✅ **Identity Management**: User assignment and tracking
- ✅ **History Synchronization**: Complete and incremental updates
- ✅ **Edit Operations**: Success cases and conflict resolution
- ✅ **Error Handling**: All error types with proper responses
- ✅ **Multi-User Scenarios**: 2+ user collaboration
- ✅ **Cursor Synchronization**: Position and selection tracking
- ✅ **Language Support**: Syntax highlighting changes
- ✅ **Access Control**: Permission-based operation validation
- ✅ **OT Algorithm**: Core transformation logic
- ✅ **Edge Cases**: Boundary conditions and error recovery

## Performance Considerations

Tests are designed to:
- Complete within reasonable time limits (< 30 seconds per test)
- Use minimal network resources
- Clean up properly to avoid resource leaks
- Run reliably in CI/CD environments
- Support parallel execution where possible
