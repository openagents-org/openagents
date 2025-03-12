"""
Advanced example demonstrating a chat application using the simple_messaging protocol in OpenAgents.

This example creates a chat application where multiple agents can join a chat room,
send messages, and share files with each other.

Usage:
    python examples/simple_messaging_chat_app.py
"""

import asyncio
import logging
import os
import tempfile
import uuid
import argparse
import sys
from pathlib import Path
from datetime import datetime

from openagents.core.agent_adapter import AgentAdapter
from openagents.core.network import Network
from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter
from openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Monkey patch the websockets.serve function to fix the path parameter issue
import websockets.server
original_serve = websockets.server.serve

async def patched_serve(handler, host, port, **kwargs):
    async def wrapper(websocket, path=""):
        await handler(websocket, path)
    return await original_serve(wrapper, host, port, **kwargs)

websockets.server.serve = patched_serve

class ChatAgent:
    """A chat agent that can send and receive messages and files."""
    
    def __init__(self, agent_id: str, agent_name: str, host: str, port: int):
        """Initialize a chat agent.
        
        Args:
            agent_id: Unique identifier for the agent
            agent_name: Human-readable name for the agent
            host: Network server host
            port: Network server port
        """
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.host = host
        self.port = port
        self.agent = None
        self.messaging = None
        self.connected = False
        self.users = {}  # agent_id -> agent_name
        self.downloads_dir = Path(tempfile.gettempdir()) / f"chat_downloads_{agent_id}"
        os.makedirs(self.downloads_dir, exist_ok=True)
        
        logger.info(f"Chat agent {agent_name} ({agent_id}) initialized")
        logger.info(f"Downloads directory: {self.downloads_dir}")
    
    async def connect(self):
        """Connect to the network server."""
        # Create the agent
        self.agent = AgentAdapter(agent_id=self.agent_id)
        
        # Create and register the simple messaging protocol adapter
        self.messaging = SimpleMessagingAgentAdapter()
        self.agent.register_protocol_adapter(self.messaging)
        
        # Register message and file handlers
        self.messaging.register_message_handler("chat", self._handle_message)
        self.messaging.register_file_handler("chat", self._handle_file)
        
        # Connect to the network
        success = await self.agent.connect_to_server(
            host=self.host,
            port=self.port,
            metadata={
                "name": self.agent_name,
                "type": "chat_agent"
            }
        )
        
        if success:
            self.connected = True
            logger.info(f"Connected to network at {self.host}:{self.port}")
            
            # Announce presence
            await self._announce_presence()
            return True
        else:
            logger.error(f"Failed to connect to network at {self.host}:{self.port}")
            return False
    
    async def disconnect(self):
        """Disconnect from the network server."""
        if self.connected and self.agent:
            # Announce departure
            await self._announce_departure()
            
            # Disconnect
            await self.agent.disconnect()
            self.connected = False
            logger.info(f"Disconnected from network")
            return True
        return False
    
    async def send_message(self, message: str, target_agent_id: str = None):
        """Send a chat message.
        
        Args:
            message: Message text
            target_agent_id: Optional target agent ID for direct messages
        """
        if not self.connected:
            logger.error("Not connected to network")
            return False
        
        content = {
            "type": "chat_message",
            "text": message,
            "timestamp": datetime.now().isoformat(),
            "sender_name": self.agent_name
        }
        
        if target_agent_id:
            # Send direct message
            await self.messaging.send_direct_message(target_agent_id, content)
            target_name = self.users.get(target_agent_id, target_agent_id)
            logger.info(f"Sent direct message to {target_name}")
        else:
            # Send broadcast message
            await self.messaging.send_broadcast_message(content)
            logger.info(f"Sent broadcast message")
        
        return True
    
    async def send_file(self, file_path: str, message: str = None, target_agent_id: str = None):
        """Send a file.
        
        Args:
            file_path: Path to the file to send
            message: Optional message text
            target_agent_id: Optional target agent ID for direct messages
        """
        if not self.connected:
            logger.error("Not connected to network")
            return False
        
        file_path = Path(file_path)
        if not file_path.exists():
            logger.error(f"File not found: {file_path}")
            return False
        
        if target_agent_id:
            # Send direct file
            await self.messaging.send_file(
                target_agent_id=target_agent_id,
                file_path=file_path,
                message_text=message
            )
            target_name = self.users.get(target_agent_id, target_agent_id)
            logger.info(f"Sent file to {target_name}: {file_path.name}")
        else:
            # Broadcast file
            await self.messaging.broadcast_file(
                file_path=file_path,
                message_text=message
            )
            logger.info(f"Broadcast file: {file_path.name}")
        
        return True
    
    async def _announce_presence(self):
        """Announce presence to other agents."""
        content = {
            "type": "presence",
            "action": "join",
            "agent_name": self.agent_name,
            "timestamp": datetime.now().isoformat()
        }
        await self.messaging.send_broadcast_message(content)
        logger.info(f"Announced presence to network")
    
    async def _announce_departure(self):
        """Announce departure to other agents."""
        content = {
            "type": "presence",
            "action": "leave",
            "agent_name": self.agent_name,
            "timestamp": datetime.now().isoformat()
        }
        await self.messaging.send_broadcast_message(content)
        logger.info(f"Announced departure from network")
    
    def _handle_message(self, content, sender_id):
        """Handle incoming messages.
        
        Args:
            content: Message content
            sender_id: ID of the sender
        """
        message_type = content.get("type", "unknown")
        
        if message_type == "chat_message":
            # Handle chat message
            sender_name = content.get("sender_name", sender_id)
            text = content.get("text", "")
            timestamp = content.get("timestamp", datetime.now().isoformat())
            
            # Store user info
            if sender_id not in self.users:
                self.users[sender_id] = sender_name
            
            # Print the message
            print(f"\n[{timestamp}] {sender_name}: {text}")
        
        elif message_type == "presence":
            # Handle presence message
            action = content.get("action", "")
            agent_name = content.get("agent_name", sender_id)
            
            if action == "join":
                # Agent joined
                self.users[sender_id] = agent_name
                print(f"\n[SYSTEM] {agent_name} joined the chat")
            
            elif action == "leave":
                # Agent left
                if sender_id in self.users:
                    del self.users[sender_id]
                print(f"\n[SYSTEM] {agent_name} left the chat")
    
    def _handle_file(self, file_id, file_content, metadata, sender_id):
        """Handle incoming files.
        
        Args:
            file_id: ID of the file
            file_content: File content
            metadata: File metadata
            sender_id: ID of the sender
        """
        sender_name = self.users.get(sender_id, sender_id)
        
        # Save the file
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file_id[-8:]}"
        file_path = self.downloads_dir / filename
        
        with open(file_path, "wb") as f:
            f.write(file_content)
        
        print(f"\n[SYSTEM] Received file from {sender_name}")
        print(f"[SYSTEM] Saved to: {file_path}")


class ChatServer:
    """A chat server that hosts the network for chat agents."""
    
    def __init__(self, host: str, port: int):
        """Initialize a chat server.
        
        Args:
            host: Network server host
            port: Network server port
        """
        self.host = host
        self.port = port
        self.network = None
        
        logger.info(f"Chat server initialized at {host}:{port}")
    
    def start(self):
        """Start the chat server."""
        # Create the network
        self.network = Network(
            network_name="ChatNetwork",
            host=self.host,
            port=self.port
        )
        
        # Register the simple messaging protocol
        self.network.register_protocol(SimpleMessagingNetworkProtocol())
        
        # Start the network server
        self.network.start()
        logger.info(f"Chat server started at {self.host}:{self.port}")
        return True
    
    def stop(self):
        """Stop the chat server."""
        if self.network:
            self.network.stop()
            logger.info(f"Chat server stopped")
            return True
        return False


async def run_chat_client(args):
    """Run a chat client."""
    # Generate a unique agent ID if not provided
    agent_id = args.agent_id or f"ChatAgent-{str(uuid.uuid4())[:8]}"
    
    # Create and connect the chat agent
    agent = ChatAgent(
        agent_id=agent_id,
        agent_name=args.name,
        host=args.host,
        port=args.port
    )
    
    # Connect to the network
    if not await agent.connect():
        print("Failed to connect to the chat server. Exiting.")
        return
    
    print(f"Connected to chat server as {args.name}")
    print("Type your messages and press Enter to send.")
    print("Commands:")
    print("  /quit - Exit the chat")
    print("  /users - List connected users")
    print("  /dm <user_id> <message> - Send a direct message")
    print("  /file <path> [message] - Send a file with optional message")
    print("  /file <user_id> <path> [message] - Send a file to a specific user")
    
    # Main chat loop
    try:
        while True:
            # Get user input
            user_input = await asyncio.get_event_loop().run_in_executor(None, input, "> ")
            
            if user_input.strip() == "":
                continue
            
            if user_input.startswith("/quit"):
                # Exit the chat
                break
            
            elif user_input.startswith("/users"):
                # List connected users
                print("\nConnected users:")
                for user_id, user_name in agent.users.items():
                    print(f"  {user_name} ({user_id})")
            
            elif user_input.startswith("/dm "):
                # Send a direct message
                parts = user_input[4:].strip().split(" ", 1)
                if len(parts) < 2:
                    print("Usage: /dm <user_id> <message>")
                    continue
                
                target_id, message = parts
                if target_id not in agent.users:
                    print(f"User {target_id} not found")
                    continue
                
                await agent.send_message(message, target_id)
            
            elif user_input.startswith("/file "):
                # Send a file
                parts = user_input[6:].strip().split(" ", 2)
                
                if len(parts) < 1:
                    print("Usage: /file <path> [message]")
                    print("       /file <user_id> <path> [message]")
                    continue
                
                if len(parts) == 1:
                    # Broadcast file without message
                    file_path = parts[0]
                    await agent.send_file(file_path)
                
                elif len(parts) == 2:
                    # Check if first part is a user ID or file path
                    if parts[0] in agent.users:
                        # Direct file without message
                        target_id, file_path = parts
                        await agent.send_file(file_path, target_agent_id=target_id)
                    else:
                        # Broadcast file with message
                        file_path, message = parts
                        await agent.send_file(file_path, message)
                
                else:
                    # Check if first part is a user ID
                    if parts[0] in agent.users:
                        # Direct file with message
                        target_id, file_path, message = parts
                        await agent.send_file(file_path, message, target_id)
                    else:
                        # Invalid format
                        print("Usage: /file <path> [message]")
                        print("       /file <user_id> <path> [message]")
            
            else:
                # Send a broadcast message
                await agent.send_message(user_input)
    
    except KeyboardInterrupt:
        print("\nExiting chat...")
    
    finally:
        # Disconnect from the network
        await agent.disconnect()
        print("Disconnected from chat server")


def run_chat_server(args):
    """Run a chat server."""
    # Create and start the chat server
    server = ChatServer(
        host=args.host,
        port=args.port
    )
    
    # Start the server
    if not server.start():
        print("Failed to start the chat server. Exiting.")
        return
    
    print(f"Chat server started at {args.host}:{args.port}")
    print("Press Ctrl+C to stop the server")
    
    try:
        # Keep the server running
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        print("\nStopping chat server...")
    finally:
        # Stop the server
        server.stop()
        print("Chat server stopped")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Simple Messaging Chat Application")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Server command
    server_parser = subparsers.add_parser("server", help="Run a chat server")
    server_parser.add_argument("--host", default="127.0.0.1", help="Server host address")
    server_parser.add_argument("--port", type=int, default=8765, help="Server port")
    
    # Client command
    client_parser = subparsers.add_parser("client", help="Run a chat client")
    client_parser.add_argument("--host", default="127.0.0.1", help="Server host address")
    client_parser.add_argument("--port", type=int, default=8765, help="Server port")
    client_parser.add_argument("--name", default=f"User-{str(uuid.uuid4())[:4]}", help="User name")
    client_parser.add_argument("--agent-id", help="Agent ID (optional)")
    
    args = parser.parse_args()
    
    if args.command == "server":
        # Run the server
        run_chat_server(args)
    
    elif args.command == "client":
        # Run the client
        await run_chat_client(args)
    
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main()) 