#!/usr/bin/env python3
"""
Script to generate Python gRPC code from proto files.
"""

import os
import subprocess
import sys
from pathlib import Path

def generate_grpc_code():
    """Generate Python gRPC code from proto files."""
    
    # Get the project root directory
    project_root = Path(__file__).parent.parent
    proto_dir = project_root / "src" / "openagents" / "proto"
    output_dir = project_root / "src" / "openagents" / "proto"
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Create __init__.py in proto directory
    init_file = output_dir / "__init__.py"
    if not init_file.exists():
        init_file.write_text('"""Generated gRPC code for OpenAgents."""\n')
    
    # Find all .proto files
    proto_files = list(proto_dir.glob("*.proto"))
    
    if not proto_files:
        print("No .proto files found in", proto_dir)
        return False
    
    print(f"Found {len(proto_files)} proto files:")
    for proto_file in proto_files:
        print(f"  - {proto_file.name}")
    
    # Generate Python code for each proto file
    for proto_file in proto_files:
        print(f"\nGenerating code for {proto_file.name}...")
        
        cmd = [
            sys.executable, "-m", "grpc_tools.protoc",
            f"--proto_path={proto_dir}",
            f"--python_out={output_dir}",
            f"--grpc_python_out={output_dir}",
            str(proto_file)
        ]
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            print(f"  ✅ Generated code for {proto_file.name}")
        except subprocess.CalledProcessError as e:
            print(f"  ❌ Error generating code for {proto_file.name}:")
            print(f"     {e.stderr}")
            return False
    
    print("\n✅ gRPC code generation completed successfully!")
    
    # List generated files
    generated_files = list(output_dir.glob("*_pb2.py")) + list(output_dir.glob("*_pb2_grpc.py"))
    if generated_files:
        print("\nGenerated files:")
        for file in generated_files:
            print(f"  - {file.name}")
    
    return True

if __name__ == "__main__":
    success = generate_grpc_code()
    sys.exit(0 if success else 1)
