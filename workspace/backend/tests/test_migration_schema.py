# -*- coding: utf-8 -*-
"""Regression tests for keeping ORM models, Alembic, and init SQL in sync."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

import app.models  # noqa: F401 - populate Base.metadata with every ORM table
from app.database import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parents[1]
ALEMBIC_VERSIONS_DIR = BACKEND_DIR / "alembic" / "versions"
INIT_SQL = REPO_ROOT / "workspace" / "scripts" / "insforge-migration" / "0001_initial_schema.sql"


@dataclass(frozen=True)
class SchemaShape:
    tables: frozenset[str]
    columns: frozenset[tuple[str, str]]
    indexes: frozenset[str]
    unique_constraints: frozenset[str]


def _column_name(column_call: ast.Call) -> str | None:
    if (
        column_call.args
        and isinstance(column_call.args[0], ast.Constant)
        and isinstance(column_call.args[0].value, str)
    ):
        return column_call.args[0].value
    return None


def _literal_arg(call: ast.Call, index: int) -> str | None:
    if len(call.args) <= index:
        return None
    value = call.args[index]
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return value.value
    return None


def _keyword_literal(call: ast.Call, name: str) -> object | None:
    for keyword in call.keywords:
        if keyword.arg == name and isinstance(keyword.value, ast.Constant):
            return keyword.value.value
    return None


def _is_call(node: ast.AST, dotted_name: str) -> bool:
    parts = dotted_name.split(".")
    current = node
    for expected in reversed(parts):
        if isinstance(current, ast.Call):
            current = current.func
        if isinstance(current, ast.Attribute):
            if current.attr != expected:
                return False
            current = current.value
        elif isinstance(current, ast.Name):
            return current.id == expected
        else:
            return False
    return True


def _metadata_shape() -> SchemaShape:
    tables = set(Base.metadata.tables)
    columns = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
    }
    indexes = {
        index.name
        for table in Base.metadata.tables.values()
        for index in table.indexes
        if index.name
    }
    unique_constraints = {
        constraint.name
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint" and constraint.name
    }
    return SchemaShape(
        frozenset(tables),
        frozenset(columns),
        frozenset(indexes),
        frozenset(unique_constraints),
    )


def _init_sql_shape() -> tuple[SchemaShape, str]:
    text = INIT_SQL.read_text()
    tables: set[str] = set()
    columns: set[tuple[str, str]] = set()
    unique_constraints: set[str] = set()

    for match in re.finditer(r"CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\n\);", text, re.S):
        table = match.group(1)
        tables.add(table)
        for line in match.group(2).splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            constraint = re.match(r"CONSTRAINT\s+(\w+)\s+UNIQUE", stripped)
            if constraint:
                unique_constraints.add(constraint.group(1))
                continue
            if stripped.startswith("PRIMARY KEY"):
                continue
            columns.add((table, stripped.split()[0].strip(",")))

    indexes = set(re.findall(r"CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)\s+ON", text))
    stamp = re.search(r"SELECT '([^']+)' WHERE NOT EXISTS", text)
    assert stamp is not None, "init SQL must stamp alembic_version"

    tables.discard("alembic_version")
    columns = {(table, column) for table, column in columns if table != "alembic_version"}
    return (
        SchemaShape(
            frozenset(tables),
            frozenset(columns),
            frozenset(indexes),
            frozenset(unique_constraints),
        ),
        stamp.group(1),
    )


def _alembic_shape() -> tuple[SchemaShape, str]:
    tables: set[str] = set()
    columns: set[tuple[str, str]] = set()
    indexes: set[str] = set()
    unique_constraints: set[str] = set()
    revisions: set[str] = set()
    down_revisions: set[str] = set()

    for path in ALEMBIC_VERSIONS_DIR.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            target_names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if "revision" in target_names and isinstance(node.value, ast.Constant):
                revisions.add(node.value.value)
            if "down_revision" in target_names and isinstance(node.value, ast.Constant) and node.value.value:
                down_revisions.add(node.value.value)

        for call in [node for node in ast.walk(tree) if isinstance(node, ast.Call)]:
            if _is_call(call, "op.create_table"):
                table = _literal_arg(call, 0)
                if not table:
                    continue
                tables.add(table)
                for arg in call.args[1:]:
                    if isinstance(arg, ast.Call) and _is_call(arg, "sa.Column"):
                        column = _column_name(arg)
                        if column:
                            columns.add((table, column))
                    if isinstance(arg, ast.Call) and _is_call(arg, "sa.UniqueConstraint"):
                        name = _keyword_literal(arg, "name")
                        if isinstance(name, str):
                            unique_constraints.add(name)
            elif _is_call(call, "op.add_column"):
                table = _literal_arg(call, 0)
                if table and len(call.args) > 1 and isinstance(call.args[1], ast.Call):
                    column = _column_name(call.args[1])
                    if column:
                        columns.add((table, column))
            elif _is_call(call, "op.create_index"):
                name = _literal_arg(call, 0)
                if name:
                    indexes.add(name)

    heads = revisions - down_revisions
    assert len(heads) == 1, f"expected one Alembic head, got {sorted(heads)}"
    return (
        SchemaShape(
            frozenset(tables),
            frozenset(columns),
            frozenset(indexes),
            frozenset(unique_constraints),
        ),
        next(iter(heads)),
    )


def test_models_alembic_and_init_sql_have_the_same_schema_shape():
    model_shape = _metadata_shape()
    init_shape, init_stamp = _init_sql_shape()
    alembic_shape, alembic_head = _alembic_shape()

    assert init_stamp == alembic_head
    assert init_shape == model_shape
    assert alembic_shape == model_shape
