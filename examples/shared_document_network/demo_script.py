#!/usr/bin/env python3
"""
Shared Document Collaboration Demo

This script demonstrates the shared document mod capabilities with multiple agents
collaborating on document creation, editing, and review.
"""

import asyncio
import json
import time
from pathlib import Path
from typing import Dict, Any

from openagents.core.network import AgentNetwork, create_network
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.mods.communication.shared_document import SharedDocumentNetworkMod


class SharedDocumentDemo:
    """Demo orchestrator for shared document collaboration."""
    
    def __init__(self):
        self.network_manager = None
        self.agents = {}
        self.demo_document_id = None
        
    async def setup_network(self):
        """Set up the network and agents."""
        print("🚀 Setting up shared document collaboration network...")
        
        # Load network configuration
        config_path = Path(__file__).parent / "network_config.yaml"
        self.network_manager = NetworkManager(str(config_path))
        
        # Start the network
        await self.network_manager.start()
        print("✅ Network started successfully")
        
        # Allow time for network to initialize
        await asyncio.sleep(2)
    
    async def create_agents(self):
        """Create and register demo agents."""
        print("👥 Creating demonstration agents...")
        
        # Create editor agent
        editor_config = Path(__file__).parent / "editor_agent.yaml"
        self.agents["editor"] = SimpleAgent(str(editor_config))
        await self.agents["editor"].start()
        
        # Create reviewer agent  
        reviewer_config = Path(__file__).parent / "reviewer_agent.yaml"
        self.agents["reviewer"] = SimpleAgent(str(reviewer_config))
        await self.agents["reviewer"].start()
        
        # Create collaborator agent
        collaborator_config = Path(__file__).parent / "collaborator_agent.yaml"
        self.agents["collaborator"] = SimpleAgent(str(collaborator_config))
        await self.agents["collaborator"].start()
        
        print("✅ All agents created and started")
        
        # Allow time for agents to register
        await asyncio.sleep(3)
    
    async def demo_document_creation(self):
        """Demonstrate document creation."""
        print("\n📝 Demo 1: Document Creation")
        print("-" * 50)
        
        editor = self.agents["editor"]
        
        # Create a new document
        initial_content = """# Project Requirements Document

## Overview
This document outlines the requirements for our new project.

## Scope
TBD - needs to be defined

## Timeline
TBD - needs scheduling

## Resources
TBD - needs resource planning"""
        
        print("Editor creating new document...")
        result = await editor.create_document(
            document_name="Project Requirements",
            initial_content=initial_content,
            access_permissions={
                "reviewer_agent": "read_write",
                "collaborator_agent": "read_write"
            }
        )
        
        print(f"Document creation result: {result}")
        
        # Note: In a real implementation, we'd get the document ID from the response
        # For this demo, we'll simulate it
        self.demo_document_id = "demo-doc-123"
        
        await asyncio.sleep(2)
    
    async def demo_collaborative_editing(self):
        """Demonstrate collaborative editing."""
        print("\n🤝 Demo 2: Collaborative Editing")
        print("-" * 50)
        
        editor = self.agents["editor"]
        collaborator = self.agents["collaborator"]
        
        # Open document for editing
        print("Agents opening document...")
        await editor.open_document(self.demo_document_id)
        await collaborator.open_document(self.demo_document_id)
        
        # Editor updates the scope section
        print("Editor updating scope section...")
        await editor.replace_lines(
            document_id=self.demo_document_id,
            start_line=5,
            end_line=5,
            content=["Define the core features and functionality needed for the MVP"]
        )
        
        # Collaborator adds timeline details
        print("Collaborator adding timeline details...")
        await collaborator.replace_lines(
            document_id=self.demo_document_id,
            start_line=8,
            end_line=8,
            content=[
                "Phase 1: Requirements gathering (2 weeks)",
                "Phase 2: Design and planning (3 weeks)", 
                "Phase 3: Development (8 weeks)",
                "Phase 4: Testing and deployment (2 weeks)"
            ]
        )
        
        # Editor adds resource information
        print("Editor adding resource information...")
        await editor.replace_lines(
            document_id=self.demo_document_id,
            start_line=11,
            end_line=11,
            content=[
                "Development team: 3 engineers",
                "Design team: 1 designer",
                "Product team: 1 product manager",
                "QA team: 1 QA engineer"
            ]
        )
        
        await asyncio.sleep(2)
    
    async def demo_commenting_and_review(self):
        """Demonstrate commenting and review functionality."""
        print("\n💬 Demo 3: Review and Comments")
        print("-" * 50)
        
        reviewer = self.agents["reviewer"]
        
        # Reviewer opens document
        print("Reviewer opening document for review...")
        await reviewer.open_document(self.demo_document_id)
        
        # Add review comments
        print("Reviewer adding feedback comments...")
        
        await reviewer.add_comment(
            document_id=self.demo_document_id,
            line_number=3,
            comment_text="Consider adding a more detailed project description here"
        )
        
        await reviewer.add_comment(
            document_id=self.demo_document_id,
            line_number=6,
            comment_text="Good scope definition. Should we also define what's out of scope?"
        )
        
        await reviewer.add_comment(
            document_id=self.demo_document_id,
            line_number=10,
            comment_text="Timeline looks reasonable. Consider adding buffer time for each phase."
        )
        
        await reviewer.add_comment(
            document_id=self.demo_document_id,
            line_number=15,
            comment_text="Resource allocation looks good. Do we have these team members confirmed?"
        )
        
        await asyncio.sleep(2)
    
    async def demo_presence_tracking(self):
        """Demonstrate agent presence tracking."""
        print("\n👀 Demo 4: Agent Presence Tracking")
        print("-" * 50)
        
        editor = self.agents["editor"]
        collaborator = self.agents["collaborator"]
        
        # Update cursor positions
        print("Agents updating their working positions...")
        
        await editor.update_cursor_position(
            document_id=self.demo_document_id,
            line_number=3,
            column_number=10
        )
        
        await collaborator.update_cursor_position(
            document_id=self.demo_document_id,
            line_number=8,
            column_number=1
        )
        
        # Check presence
        print("Checking agent presence...")
        presence_result = await editor.get_agent_presence(self.demo_document_id)
        print(f"Agent presence: {presence_result}")
        
        await asyncio.sleep(2)
    
    async def demo_document_management(self):
        """Demonstrate document management features."""
        print("\n📋 Demo 5: Document Management")
        print("-" * 50)
        
        editor = self.agents["editor"]
        
        # Get document content
        print("Getting current document content...")
        content_result = await editor.get_document_content(
            document_id=self.demo_document_id,
            include_comments=True,
            include_presence=True
        )
        print(f"Document content result: {content_result}")
        
        # Get document history
        print("Getting document operation history...")
        history_result = await editor.get_document_history(
            document_id=self.demo_document_id,
            limit=10
        )
        print(f"Document history result: {history_result}")
        
        # List documents
        print("Listing all available documents...")
        list_result = await editor.list_documents(include_closed=False)
        print(f"Document list result: {list_result}")
        
        await asyncio.sleep(2)
    
    async def run_demo(self):
        """Run the complete demo."""
        try:
            print("🎯 Starting Shared Document Collaboration Demo")
            print("=" * 60)
            
            # Setup
            await self.setup_network()
            await self.create_agents()
            
            # Run demo scenarios
            await self.demo_document_creation()
            await self.demo_collaborative_editing()
            await self.demo_commenting_and_review()
            await self.demo_presence_tracking()
            await self.demo_document_management()
            
            print("\n🎉 Demo completed successfully!")
            print("=" * 60)
            
        except Exception as e:
            print(f"❌ Demo failed with error: {e}")
            
        finally:
            await self.cleanup()
    
    async def cleanup(self):
        """Clean up resources."""
        print("\n🧹 Cleaning up...")
        
        # Close documents
        if self.demo_document_id and self.agents:
            for agent in self.agents.values():
                try:
                    await agent.close_document(self.demo_document_id)
                except:
                    pass
        
        # Stop agents
        for agent in self.agents.values():
            try:
                await agent.stop()
            except:
                pass
        
        # Stop network
        if self.network_manager:
            try:
                await self.network_manager.stop()
            except:
                pass
        
        print("✅ Cleanup completed")


async def main():
    """Main demo entry point."""
    demo = SharedDocumentDemo()
    await demo.run_demo()


if __name__ == "__main__":
    # Set up event loop for Windows compatibility
    if hasattr(asyncio, 'WindowsProactorEventLoopPolicy'):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    asyncio.run(main())
