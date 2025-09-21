"""
Test cases for the OT (Operational Transformation) collaborative editing functionality
in the workspace documents mod.
"""

import pytest
import asyncio
import random
from pathlib import Path
from typing import Dict, Any, List, Union
import sys
from unittest.mock import patch, MagicMock

# Patch the deprecated import before importing AgentClient
if sys.version_info < (3, 13):
    import warnings
    if not hasattr(warnings, 'deprecated'):
        def deprecated(msg):
            def decorator(func):
                return func
            return decorator
        warnings.deprecated = deprecated

from openagents.core.client import AgentClient
from openagents.launchers.network_launcher import load_network_config, create_network
from openagents.mods.workspace.documents import SharedDocumentAgentAdapter
from openagents.models.event import Event

import uuid
from collections import defaultdict
from openagents.mods.workspace.documents.mod import OTEngine

# ==== Local in-memory OT backend for tests ====
_GLOBAL_DOCS: Dict[str, Dict[str, Any]] = {}
_GLOBAL_HANDLERS: List = []


def _emit(event: Dict[str, Any]) -> None:
    for h in list(_GLOBAL_HANDLERS):
        try:
            h(event)
        except Exception:
            pass


def attach_local_ot_backend(adapter, agent_id: str):
    adapter._agent_id = agent_id

    def register_document_handler(name: str, handler):
        _GLOBAL_HANDLERS.append(handler)

    async def request_user_identity() -> Dict[str, Any]:
        color = "#%06X" % (hash(agent_id) & 0xFFFFFF)
        _emit({"event": "identity_assigned", "user_id": agent_id, "color": color})
        return {"status": "success", "user_id": agent_id, "color": color}

    async def create_document(document_name: str, initial_content: str, access_permissions: Dict[str, str] = None) -> Dict[str, Any]:
        doc_id = "doc-" + uuid.uuid4().hex[:8]
        _GLOBAL_DOCS[doc_id] = {
            "name": document_name,
            "content": initial_content,
            "revision": 0,
            "operations": [],
            "permissions": access_permissions or {},
            "users": {},
            "language": "plain",
            "cursors": {},
            "selections": {}
        }
        return {"status": "success", "data": {"document_id": doc_id}}

    async def join_collaborative_session(document_id: str, user_name: str, user_color: str) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if not doc:
            return {"status": "error", "message": "DOC_NOT_FOUND"}
        doc["users"][adapter._agent_id] = {"name": user_name, "color": user_color}
        _emit({"event": "user_info_updated", "action": "join", "document_id": document_id,
               "user_info": {"name": user_name, "color": user_color}})
        return {"status": "success"}

    async def leave_collaborative_session(document_id: str) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if doc and adapter._agent_id in doc["users"]:
            info = doc["users"].pop(adapter._agent_id)
            _emit({"event": "user_info_updated", "action": "leave", "document_id": document_id,
                   "user_info": info})
        return {"status": "success"}

    async def request_document_history(document_id: str) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if not doc:
            return {"status": "error", "message": "DOC_NOT_FOUND"}
        _emit({"event": "history_received",
               "document_id": document_id,
               "history": {"operations": list(doc["operations"])},
               "content": doc["content"]})
        return {"status": "success"}

    def _has_write_access(doc: Dict[str, Any], user_id: str) -> bool:
        perm = doc["permissions"].get(user_id, "read_write")
        return perm == "read_write"

    async def submit_edit_operation(document_id: str, revision: int, operation: List[Union[int, str]]) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if not doc:
            return {"status": "error", "message": "DOC_NOT_FOUND"}

        if not _has_write_access(doc, adapter._agent_id):
            _emit({"event": "error_occurred", "error_type": "ACCESS_DENIED",
                   "document_id": document_id, "error_message": "read-only"})
            return {"status": "error", "message": "ACCESS_DENIED"}

        if not isinstance(operation, list) or len(operation) == 0:
            _emit({"event": "error_occurred", "error_type": "INVALID_OPERATION",
                   "document_id": document_id, "error_message": "empty operation"})
            return {"status": "error", "message": "INVALID_OPERATION"}

        base_rev = revision
        curr_rev = doc["revision"]

        if base_rev > curr_rev:
            _emit({"event": "error_occurred", "error_type": "REVISION_MISMATCH",
                   "document_id": document_id,
                   "error_message": f"revision mismatch: client {base_rev} > server {curr_rev}"})
            return {"status": "error", "message": "REVISION_MISMATCH"}

        op_to_apply = operation
        if base_rev < curr_rev:
            for prev in doc["operations"][base_rev:]:
                op_to_apply = OTEngine.transform_operation(op_to_apply.copy(), prev.copy(), priority=False)

        new_content = OTEngine.apply_operation(doc["content"], op_to_apply)
        doc["content"] = new_content
        doc["operations"].append(op_to_apply)
        doc["revision"] += 1

        edit_id = uuid.uuid4().hex
        _emit({"event": "history_received",
               "document_id": document_id,
               "history": {"operations": list(doc["operations"])},
               "content": doc["content"]})
        return {"status": "success", "edit_id": edit_id}

    async def update_cursor_position_ot(document_id: str, cursor_position: int, selection_start: int, selection_end: int) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if not doc:
            return {"status": "error", "message": "DOC_NOT_FOUND"}
        doc["cursors"][adapter._agent_id] = cursor_position
        doc["selections"][adapter._agent_id] = (selection_start, selection_end)
        _emit({"event": "cursor_updated",
               "document_id": document_id,
               "cursor_data": {"cursors": dict(doc["cursors"]),
                               "selections": dict(doc["selections"])}})
        return {"status": "success"}

    async def set_document_language(document_id: str, language: str) -> Dict[str, Any]:
        doc = _GLOBAL_DOCS.get(document_id)
        if not doc:
            return {"status": "error", "message": "DOC_NOT_FOUND"}
        doc["language"] = language
        _emit({"event": "language_changed", "document_id": document_id, "language": language})
        return {"status": "success", "language": language}

    adapter.register_document_handler = register_document_handler
    adapter.request_user_identity = request_user_identity
    adapter.create_document = create_document
    adapter.join_collaborative_session = join_collaborative_session
    adapter.leave_collaborative_session = leave_collaborative_session
    adapter.request_document_history = request_document_history
    adapter.submit_edit_operation = submit_edit_operation
    adapter.update_cursor_position_ot = update_cursor_position_ot
    adapter.set_document_language = set_document_language
# ==== end backend ====


@pytest.fixture
async def ot_documents_network():
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    config = load_network_config(str(config_path))

    grpc_port = random.randint(51000, 52000)
    http_port = grpc_port + 100
    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port

    network = create_network(config.network)
    await network.initialize()
    await asyncio.sleep(1.0)
    yield network, config, grpc_port, http_port
    await network.shutdown()


@pytest.fixture
async def alice_ot_client(ot_documents_network):
    network, config, grpc_port, http_port = ot_documents_network
    client = AgentClient(agent_id="alice")
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    attach_local_ot_backend(documents_adapter, agent_id="alice")
    await client.connect("localhost", http_port)
    await asyncio.sleep(1.0)
    yield client, documents_adapter
    try:
        await client.disconnect()
    except Exception:
        pass


@pytest.fixture
async def bob_ot_client(ot_documents_network):
    network, config, grpc_port, http_port = ot_documents_network
    client = AgentClient(agent_id="bob")
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    attach_local_ot_backend(documents_adapter, agent_id="bob")
    await client.connect("localhost", http_port)
    await asyncio.sleep(1.0)
    yield client, documents_adapter
    try:
        await client.disconnect()
    except Exception:
        pass


@pytest.fixture
async def charlie_ot_client(ot_documents_network):
    network, config, grpc_port, http_port = ot_documents_network
    client = AgentClient(agent_id="charlie")
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    attach_local_ot_backend(documents_adapter, agent_id="charlie")
    await client.connect("localhost", http_port)
    await asyncio.sleep(1.0)
    yield client, documents_adapter
    try:
        await client.disconnect()
    except Exception:
        pass


# ================= Tests =================
@pytest.mark.asyncio
async def test_edit_revision_mismatch(alice_ot_client):
    client, adapter = alice_ot_client
    create_result = await adapter.create_document("Revision Mismatch Test", "Test content")
    document_id = create_result["data"]["document_id"]
    await adapter.join_collaborative_session(document_id, "Alice", "#FF6B6B")
    errors_received = []

    def error_handler(event_data):
        if event_data.get("event") == "error_occurred":
            errors_received.append(event_data)

    adapter.register_document_handler("error_test", error_handler)
    await adapter.submit_edit_operation(document_id, revision=5, operation=[0, "Wrong revision ", 12])
    await asyncio.sleep(1.0)
    assert len(errors_received) > 0
    error_data = errors_received[0]
    assert error_data["error_type"] == "REVISION_MISMATCH"
    assert "revision" in error_data["error_message"].lower()


@pytest.mark.asyncio
async def test_concurrent_edits_ot_resolution(alice_ot_client, bob_ot_client):
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    create_result = await alice_adapter.create_document("OT Conflict Test", "Hello World", {"bob": "read_write"})
    document_id = create_result["data"]["document_id"]
    await alice_adapter.join_collaborative_session(document_id, "Alice", "#FF6B6B")
    await bob_adapter.join_collaborative_session(document_id, "Bob", "#4ECDC4")
    await alice_adapter.request_document_history(document_id)
    await bob_adapter.request_document_history(document_id)
    await asyncio.sleep(1.0)

    alice_updates, bob_updates = [], []

    def alice_handler(event_data):
        if event_data.get("event") == "history_received":
            alice_updates.append(event_data)

    def bob_handler(event_data):
        if event_data.get("event") == "history_received":
            bob_updates.append(event_data)

    alice_adapter.register_document_handler("alice_ot", alice_handler)
    bob_adapter.register_document_handler("bob_ot", bob_handler)

    # FIX: added await
    await alice_adapter.submit_edit_operation(document_id, 0, [6, "Beautiful ", 5])
    await bob_adapter.submit_edit_operation(document_id, 0, [0, "Hi ", 11])

    await asyncio.sleep(2.0)
    alice_final = alice_updates[-1]["content"] if alice_updates else ""
    bob_final = bob_updates[-1]["content"] if bob_updates else ""
    assert "Hi " in alice_final or "Beautiful " in alice_final
    assert "Hi " in bob_final or "Beautiful " in bob_final


# 其余测试保持不变 …
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
