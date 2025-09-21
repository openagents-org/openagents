"""
Unit tests for the OT (Operational Transformation) Engine.

This test suite validates the core OT algorithm implementation including:
- Operation application
- Operation transformation
- Operation composition
- Edge cases and error handling
"""

import pytest
from typing import List, Union

import sys
from unittest.mock import patch, MagicMock

# Patch the deprecated import before importing AgentClient
if sys.version_info < (3, 13):
    # Mock the deprecated decorator for older Python versions
    import warnings
    if not hasattr(warnings, 'deprecated'):
        def deprecated(msg):
            def decorator(func):
                return func
            return decorator
        warnings.deprecated = deprecated
from openagents.mods.workspace.documents.mod import OTEngine

class TestOTEngine:
    """Test cases for the OT Engine core functionality."""
    
    def test_apply_operation_insert(self):
        """Test applying insert operations to document content."""
        content = "Hello World"
        
        # Insert at beginning
        operation = ["Hi ", 11]  # Insert "Hi " then retain 11 chars
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hi Hello World"
        
        # Insert in middle
        operation = [6, "Beautiful ", 5]  # Retain 6, insert "Beautiful ", retain 5
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hello Beautiful World"
        
        # Insert at end
        operation = [11, "!"]  # Retain 11, insert "!"
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hello World!"
    
    def test_apply_operation_delete(self):
        """Test applying delete operations to document content."""
        content = "Hello Beautiful World"
        
        # Delete from beginning
        operation = [-6, 15]  # Delete 6 chars, retain 15
        result = OTEngine.apply_operation(content, operation)
        assert result == "Beautiful World"
        
        # Delete from middle
        operation = [6, -10, 5]  # Retain 6, delete 10, retain 5
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hello World"
        
        # Delete from end
        operation = [11, -10]  # Retain 11, delete 10
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hello Beaut"
    
    def test_apply_operation_mixed(self):
        """Test applying mixed operations (retain, insert, delete)."""
        content = "Hello World"
        
        # Complex operation: retain 6, insert "Beautiful ", delete 5
        operation = [6, "Beautiful ", -5]
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hello Beautiful "
        
        # Another complex operation
        operation = [0, "Hi ", 6, "Amazing ", -5]  # Insert "Hi " at start, retain 6, insert "Amazing ", delete 5
        result = OTEngine.apply_operation(content, operation)
        assert result == "Hi Hello Amazing "
    
    def test_transform_operation_concurrent_inserts(self):
        """Test transforming concurrent insert operations."""
        # Both operations insert at different positions
        op1 = [0, "A", 5]  # Insert "A" at beginning
        op2 = [3, "B", 2]  # Insert "B" at position 3
        
        # Transform op1 against op2 (op2 applied first)
        transformed = OTEngine.transform_operation(op1.copy(), op2.copy())
        
        # op1 should still insert at beginning since op2 inserts after
        assert transformed == [0, "A", 5]
        
        # Transform op2 against op1 (op1 applied first)
        op1_copy = [0, "A", 5]
        op2_copy = [3, "B", 2]
        transformed = OTEngine.transform_operation(op2_copy, op1_copy)
        
        # op2 should now insert at position 4 (3 + length of "A")
        assert transformed == [4, "B", 2]
    
    def test_transform_operation_concurrent_deletes(self):
        """Test transforming concurrent delete operations."""
        # Both operations delete different ranges
        op1 = [2, -3, 5]  # Delete 3 chars starting at position 2
        op2 = [6, -2, 2]  # Delete 2 chars starting at position 6
        
        # Transform op1 against op2 (op2 applied first)
        transformed = OTEngine.transform_operation(op1.copy(), op2.copy())
        
        # Since op2 deletes after op1's range, op1 should be unchanged
        assert transformed == [2, -3, 5]
        
        # Transform op2 against op1 (op1 applied first)  
        op1_copy = [2, -3, 5]
        op2_copy = [6, -2, 2]
        transformed = OTEngine.transform_operation(op2_copy, op1_copy)
        
        # op2 should now delete at position 3 (6 - 3 deleted chars)
        assert transformed == [3, -2, 2]
    
    def test_transform_operation_insert_vs_delete(self):
        """Test transforming insert operation against delete operation."""
        op1 = [3, "ABC", 5]  # Insert "ABC" at position 3
        op2 = [1, -4, 3]     # Delete 4 chars starting at position 1
        
        # Transform op1 against op2 (op2 applied first)
        transformed = OTEngine.transform_operation(op1.copy(), op2.copy())
        
        # Insert position should be adjusted for the deletion
        # If deletion removes chars before insert position, adjust accordingly
        assert isinstance(transformed, list)
        assert len(transformed) > 0
    
    def test_compose_operations_simple(self):
        """Test composing simple operations."""
        # First operation: insert "Hello " at beginning
        op1 = [0, "Hello ", 0]
        
        # Second operation: insert "World" at end (after "Hello ")
        op2 = [6, "World", 0]
        
        # Compose operations
        composed = OTEngine.compose_operations(op1.copy(), op2.copy())
        
        # Should result in inserting "Hello World" at beginning
        assert "Hello " in str(composed)
        assert "World" in str(composed)
    
    def test_compose_operations_complex(self):
        """Test composing complex operations."""
        # First operation: retain 5, insert "Beautiful ", retain 5
        op1 = [5, "Beautiful ", 5]
        
        # Second operation: retain 15, delete 5, insert "Amazing"
        op2 = [15, -5, "Amazing"]
        
        # Compose operations
        composed = OTEngine.compose_operations(op1.copy(), op2.copy())
        
        # Result should be a valid operation
        assert isinstance(composed, list)
        assert len(composed) > 0
    
    def test_edge_case_empty_operations(self):
        """Test edge cases with empty operations."""
        content = "Hello World"
        
        # Empty operation should return original content
        result = OTEngine.apply_operation(content, [])
        assert result == content
        
        # Operation with only retains should return original content
        result = OTEngine.apply_operation(content, [11])
        assert result == content
    
    def test_edge_case_operation_longer_than_content(self):
        """Test operations that try to operate beyond content length."""
        content = "Hi"
        
        # Retain more than content length - should handle gracefully
        operation = [10]  # Try to retain 10 chars from 2-char string
        result = OTEngine.apply_operation(content, operation)
        assert result == content  # Should return original content
        
        # Delete more than available - should handle gracefully
        operation = [-10]  # Try to delete 10 chars from 2-char string
        result = OTEngine.apply_operation(content, operation)
        assert result == ""  # Should delete all available content
    
    def test_transform_operation_priority(self):
        """Test operation transformation with priority handling."""
        # Two concurrent inserts at same position
        op1 = [5, "A", 5]
        op2 = [5, "B", 5]
        
        # Transform with priority=True
        transformed_priority = OTEngine.transform_operation(op1.copy(), op2.copy(), priority=True)
        
        # Transform with priority=False
        transformed_no_priority = OTEngine.transform_operation(op1.copy(), op2.copy(), priority=False)
        
        # Results should be different based on priority
        assert transformed_priority != transformed_no_priority or len(transformed_priority) == 0
    
    def test_operation_format_validation(self):
        """Test that operations handle different input formats correctly."""
        content = "Hello World"
        
        # Test with integers and strings
        operation = [5, " Beautiful", 6]
        result = OTEngine.apply_operation(content, operation)
        assert "Beautiful" in result
        
        # Test with negative integers (deletes)
        operation = [5, -1, 5]  # Delete 1 char at position 5
        result = OTEngine.apply_operation(content, operation)
        assert len(result) == len(content) - 1
    
    def test_multiple_sequential_operations(self):
        """Test applying multiple operations sequentially."""
        content = "Hello World"
        
        # Apply first operation
        op1 = [0, "Hi ", 11]
        content = OTEngine.apply_operation(content, op1)
        assert content == "Hi Hello World"
        
        # Apply second operation to result
        op2 = [3, "Beautiful ", 11]
        content = OTEngine.apply_operation(content, op2)
        assert content == "Hi Beautiful Hello World"
        
        # Apply third operation
        op3 = [23, "!"]
        content = OTEngine.apply_operation(content, op3)
        assert content == "Hi Beautiful Hello World!"
    
    def test_transform_operation_overlapping_ranges(self):
        """Test transforming operations with overlapping ranges."""
        # Operation 1: delete chars 2-5
        op1 = [2, -3, 6]
        
        # Operation 2: delete chars 4-7 (overlaps with op1)
        op2 = [4, -3, 4]
        
        # Transform op1 against op2
        transformed = OTEngine.transform_operation(op1.copy(), op2.copy())
        
        # Should handle overlapping deletes gracefully
        assert isinstance(transformed, list)
        
        # Transform op2 against op1
        transformed = OTEngine.transform_operation(op2.copy(), op1.copy())
        
        # Should handle overlapping deletes gracefully
        assert isinstance(transformed, list)


if __name__ == "__main__":
    # Run the tests
    try:
        pytest.main([__file__, "-v"])
    except Exception as e:
        print(f"Error running tests: {e}")
        sys.exit(1)