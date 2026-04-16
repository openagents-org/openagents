# -*- coding: utf-8 -*-
"""
Pluggable file storage backends.

FILE_STORAGE_BACKEND=local  → LocalFileStore (default, saves to disk)
FILE_STORAGE_BACKEND=s3     → S3FileStore (production, saves to AWS S3)
"""

import os
from pathlib import Path
from typing import Protocol


class FileStore(Protocol):
    """Protocol for file blob storage."""

    def save(self, workspace_id: str, file_id: str, filename: str, data: bytes) -> str:
        """Save file data. Returns the storage key."""
        ...

    def read(self, storage_key: str) -> bytes:
        """Read file data by storage key."""
        ...

    def delete(self, storage_key: str) -> None:
        """Delete file data by storage key."""
        ...

    def exists(self, storage_key: str) -> bool:
        """Check if file exists at storage key."""
        ...


class LocalFileStore:
    """Store files on the local filesystem."""

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save(self, workspace_id: str, file_id: str, filename: str, data: bytes) -> str:
        # Reject filenames containing any directory component.
        # Path(x).name strips dirs, so if it differs from the input the caller
        # passed a path (e.g. "../../etc/passwd", "/etc/passwd", "sub/file.txt").
        safe_filename = Path(filename).name
        if safe_filename != filename:
            raise ValueError(f"Filename must not contain directory components: {filename!r}")
        if not safe_filename or safe_filename in (".", ".."):
            raise ValueError(f"Invalid filename: {filename!r}")

        key = f"{workspace_id}/{file_id}/{safe_filename}"
        path = self.base_dir / key

        # Belt-and-suspenders: verify the resolved path stays inside base_dir.
        try:
            path.resolve().relative_to(self.base_dir.resolve())
        except ValueError:
            raise ValueError(f"Path traversal detected for filename: {filename!r}")

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read(self, storage_key: str) -> bytes:
        path = self.base_dir / storage_key
        if not path.exists():
            raise FileNotFoundError(f"File not found: {storage_key}")
        return path.read_bytes()

    def delete(self, storage_key: str) -> None:
        path = self.base_dir / storage_key
        if path.exists():
            path.unlink()

    def exists(self, storage_key: str) -> bool:
        return (self.base_dir / storage_key).exists()


class S3FileStore:
    """Store files in AWS S3."""

    def __init__(self, bucket: str, region: str = "us-east-1"):
        import boto3
        self.bucket = bucket
        self.s3 = boto3.client("s3", region_name=region)

    def save(self, workspace_id: str, file_id: str, filename: str, data: bytes) -> str:
        key = f"{workspace_id}/{file_id}/{filename}"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        return key

    def read(self, storage_key: str) -> bytes:
        resp = self.s3.get_object(Bucket=self.bucket, Key=storage_key)
        return resp["Body"].read()

    def delete(self, storage_key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=storage_key)

    def exists(self, storage_key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=storage_key)
            return True
        except Exception:
            return False


_store: FileStore | None = None


def get_file_store() -> FileStore:
    """Get the configured file store singleton."""
    global _store
    if _store is not None:
        return _store

    from app.config import config

    if config.FILE_STORAGE_BACKEND == "s3":
        _store = S3FileStore(bucket=config.S3_BUCKET, region=config.S3_REGION)
    else:
        _store = LocalFileStore(base_dir=config.FILE_STORAGE_PATH)

    return _store
