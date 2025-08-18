#!/usr/bin/env python3
"""
Simple Shared Document Demo

This script demonstrates the core shared document mod functionality
with a simplified setup that doesn't require full network infrastructure.
"""

import asyncio
import uuid
from datetime import datetime
from unittest.mock import Mock, AsyncMock

from openagents.mods.communication.shared_document import (
    SharedDocumentNetworkMod,
    SharedDocumentAgentAdapter,
    CreateDocumentMessage,
    OpenDocumentMessage,
    InsertLinesMessage,
    AddCommentMessage,
    UpdateCursorPositionMessage,
    CursorPosition
)


class SimpleSharedDocumentDemo:
    """Simplified demo for shared document functionality."""
    
    def __init__(self):
        self.network_mod = None
        self.adapters = {}
        
    async def setup(self):
        """Set up the demo environment."""
        print("🚀 Setting up Shared Document Demo...")
        
        # Create network mod
        self.network_mod = SharedDocumentNetworkMod()
        
        # Mock network
        mock_network = Mock()
        mock_network.node_id = "demo_network"
        mock_network.send_message = AsyncMock()
        self.network_mod.bind_network(mock_network)
        
        # Initialize
        self.network_mod.initialize()
        
        # Create agent adapters
        for agent_id in ["editor", "reviewer", "collaborator"]:
            adapter = SharedDocumentAgentAdapter()
            adapter.bind_agent(agent_id)
            adapter.network_interface = Mock()
            adapter.network_interface.send_mod_message = AsyncMock()
            self.adapters[agent_id] = adapter
        
        print("✅ Demo setup complete!")
        
    async def demo_document_creation(self):
        """Demo document creation."""
        print("\n📝 Demo 1: Document Creation")
        print("-" * 40)
        
        # Editor creates a document
        create_msg = CreateDocumentMessage(
            document_name="Project Requirements",
            initial_content="# Project Requirements\n\n## Overview\nTBD\n\n## Timeline\nTBD",
            access_permissions={
                "reviewer": "read_write",
                "collaborator": "read_write"
            },
            sender_id="editor"
        )
        
        print("📄 Editor creating document: 'Project Requirements'")
        await self.network_mod._handle_create_document(create_msg, "editor")
        
        # Get the created document
        doc_id = list(self.network_mod.documents.keys())[0]
        document = self.network_mod.documents[doc_id]
        
        print(f"✅ Document created with ID: {doc_id[:8]}...")
        print(f"📖 Initial content ({len(document.content)} lines):")
        for i, line in enumerate(document.content, 1):
            print(f"   {i}: {line}")
        
        return doc_id
    
    async def demo_collaborative_editing(self, doc_id):
        """Demo collaborative editing."""
        print("\n🤝 Demo 2: Collaborative Editing")
        print("-" * 40)
        
        document = self.network_mod.documents[doc_id]
        
        # Reviewer opens document
        open_msg = OpenDocumentMessage(document_id=doc_id, sender_id="reviewer")
        await self.network_mod._handle_open_document(open_msg, "reviewer")
        print("👀 Reviewer opened the document")
        
        # Collaborator opens document
        open_msg = OpenDocumentMessage(document_id=doc_id, sender_id="collaborator")
        await self.network_mod._handle_open_document(open_msg, "collaborator")
        print("👀 Collaborator opened the document")
        
        # Reviewer updates overview section
        replace_msg = InsertLinesMessage(
            document_id=doc_id,
            line_number=4,
            content=[
                "Define core features and functionality for MVP",
                "Target users: Development teams",
                "Key goals: Collaboration and efficiency"
            ],
            sender_id="reviewer"
        )
        await self.network_mod._handle_insert_lines(replace_msg, "reviewer")
        print("✏️  Reviewer added overview details")
        
        # Collaborator updates timeline
        replace_msg = InsertLinesMessage(
            document_id=doc_id,
            line_number=6,
            content=[
                "## Timeline",
                "Phase 1: Requirements (2 weeks)",
                "Phase 2: Design (3 weeks)",
                "Phase 3: Development (8 weeks)",
                "Phase 4: Testing (2 weeks)"
            ],
            sender_id="collaborator"
        )
        await self.network_mod._handle_insert_lines(replace_msg, "collaborator")
        print("📅 Collaborator added timeline details")
        
        print(f"\n📊 Document now has {len(document.content)} lines (version {document.version})")
        
    async def demo_commenting_system(self, doc_id):
        """Demo commenting functionality."""
        print("\n💬 Demo 3: Commenting System")
        print("-" * 40)
        
        document = self.network_mod.documents[doc_id]
        
        # Add comments from different agents
        comments = [
            (2, "reviewer", "Consider adding success metrics here"),
            (5, "collaborator", "Should we include stakeholder information?"),
            (8, "editor", "Timeline looks reasonable - good work!"),
            (10, "reviewer", "We might need buffer time for each phase")
        ]
        
        for line_num, agent, comment_text in comments:
            comment_msg = AddCommentMessage(
                document_id=doc_id,
                line_number=line_num,
                comment_text=comment_text,
                sender_id=agent
            )
            await self.network_mod._handle_add_comment(comment_msg, agent)
            print(f"💭 {agent} commented on line {line_num}: \"{comment_text}\"")
        
        print(f"\n📝 Total comments: {sum(len(comments) for comments in document.comments.values())}")
        
    async def demo_presence_tracking(self, doc_id):
        """Demo agent presence tracking."""
        print("\n👥 Demo 4: Agent Presence Tracking")
        print("-" * 40)
        
        document = self.network_mod.documents[doc_id]
        
        # Update cursor positions
        positions = [
            ("editor", 3, 15),
            ("reviewer", 7, 1),
            ("collaborator", 12, 8)
        ]
        
        for agent, line, col in positions:
            cursor_msg = UpdateCursorPositionMessage(
                document_id=doc_id,
                cursor_position=CursorPosition(line_number=line, column_number=col),
                sender_id=agent
            )
            await self.network_mod._handle_update_cursor_position(cursor_msg, agent)
            print(f"📍 {agent} cursor at line {line}, column {col}")
        
        # Show active agents
        active_agents = list(document.active_agents)
        print(f"\n🟢 Active agents: {', '.join(active_agents)}")
        
    async def demo_final_state(self, doc_id):
        """Show final document state."""
        print("\n📋 Demo 5: Final Document State")
        print("-" * 40)
        
        document = self.network_mod.documents[doc_id]
        
        print(f"📄 Document: {document.name}")
        print(f"🔢 Version: {document.version}")
        print(f"👥 Active agents: {len(document.active_agents)}")
        print(f"💬 Total comments: {sum(len(comments) for comments in document.comments.values())}")
        print(f"📏 Lines of content: {len(document.content)}")
        
        print(f"\n📖 Final content:")
        for i, line in enumerate(document.content, 1):
            comments_on_line = document.comments.get(i, [])
            comment_indicator = f" 💬({len(comments_on_line)})" if comments_on_line else ""
            print(f"   {i:2}: {line}{comment_indicator}")
        
        if document.comments:
            print(f"\n💬 Comments summary:")
            for line_num, comments in document.comments.items():
                for comment in comments:
                    print(f"   Line {line_num}: {comment.agent_id} - \"{comment.comment_text}\"")
    
    async def run_demo(self):
        """Run the complete demo."""
        try:
            print("🎯 Shared Document Mod - Live Demo")
            print("=" * 50)
            
            await self.setup()
            
            # Run demo scenarios
            doc_id = await self.demo_document_creation()
            await self.demo_collaborative_editing(doc_id)
            await self.demo_commenting_system(doc_id)
            await self.demo_presence_tracking(doc_id)
            await self.demo_final_state(doc_id)
            
            print(f"\n🎉 Demo completed successfully!")
            print("=" * 50)
            print("✨ The shared document mod is working perfectly!")
            
        except Exception as e:
            print(f"❌ Demo failed: {e}")
            import traceback
            traceback.print_exc()
        
        finally:
            if self.network_mod:
                self.network_mod.shutdown()


async def main():
    """Run the demo."""
    demo = SimpleSharedDocumentDemo()
    await demo.run_demo()


if __name__ == "__main__":
    asyncio.run(main())
