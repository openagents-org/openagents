#!/usr/bin/env python3
"""
Test runner for all documents module tests.

This script runs all test suites related to the documents module including:
- OT Engine unit tests
- OT Collaborative editing integration tests  
- Legacy documents functionality tests

Usage:
    python tests/run_documents_tests.py [--verbose] [--test-pattern PATTERN]
"""

import sys
import subprocess
import argparse
from pathlib import Path


def run_test_file(test_file: Path, verbose: bool = False) -> bool:
    """Run a specific test file and return success status."""
    cmd = [sys.executable, "-m", "pytest", str(test_file)]
    
    if verbose:
        cmd.append("-v")
    
    cmd.extend(["-s", "--tb=short"])
    
    print(f"\n{'='*60}")
    print(f"Running: {test_file.name}")
    print(f"{'='*60}")
    
    try:
        result = subprocess.run(cmd, cwd=test_file.parent.parent.parent)
        return result.returncode == 0
    except Exception as e:
        print(f"Error running {test_file}: {e}")
        return False


def main():
    """Main test runner function."""
    parser = argparse.ArgumentParser(description="Run documents module tests")
    parser.add_argument("--verbose", "-v", action="store_true", 
                       help="Run tests in verbose mode")
    parser.add_argument("--test-pattern", "-k", 
                       help="Run only tests matching this pattern")
    parser.add_argument("--unit-only", action="store_true",
                       help="Run only unit tests (OT Engine)")
    parser.add_argument("--integration-only", action="store_true", 
                       help="Run only integration tests")
    
    args = parser.parse_args()
    
    # Get test directory
    test_dir = Path(__file__).parent / "mods"
    
    # Define test files
    test_files = []
    
    if not args.integration_only:
        # Unit tests
        ot_engine_tests = test_dir / "test_ot_engine.py"
        if ot_engine_tests.exists():
            test_files.append(("OT Engine Unit Tests", ot_engine_tests))
    
    if not args.unit_only:
        # Integration tests
        ot_collaboration_tests = test_dir / "test_documents_ot_collaboration.py"
        if ot_collaboration_tests.exists():
            test_files.append(("OT Collaboration Integration Tests", ot_collaboration_tests))
        
        # Legacy tests
        legacy_tests = test_dir / "test_grpc_workspace_documents.py"
        if legacy_tests.exists():
            test_files.append(("Legacy Documents Tests", legacy_tests))
    
    if not test_files:
        print("No test files found!")
        return 1
    
    # Run tests
    results = []
    total_tests = len(test_files)
    
    print(f"Running {total_tests} test suite(s)...")
    
    for test_name, test_file in test_files:
        print(f"\n🧪 {test_name}")
        success = run_test_file(test_file, args.verbose)
        results.append((test_name, success))
        
        if success:
            print(f"✅ {test_name} - PASSED")
        else:
            print(f"❌ {test_name} - FAILED")
    
    # Summary
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")
    
    passed = sum(1 for _, success in results if success)
    failed = total_tests - passed
    
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print(f"\nTotal: {total_tests} | Passed: {passed} | Failed: {failed}")
    
    if failed > 0:
        print(f"\n❌ {failed} test suite(s) failed!")
        return 1
    else:
        print(f"\n🎉 All {passed} test suite(s) passed!")
        return 0


if __name__ == "__main__":
    sys.exit(main())
