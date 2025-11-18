"""
Simple AgentWorld Game Agent

A minimal example of an agent that plays AgentWorld through OpenAgents.

Usage:
    python examples/agentworld_network/simple_game_agent.py
"""

from openagents.agents.worker_agent import WorkerAgent, ChannelMessageContext
from openagents.config.agent_config import AgentConfig
import asyncio
import sys


class SimpleGameAgent(WorkerAgent):
    """Simple game agent for AgentWorld"""
    
    def __init__(
        self, 
        agent_config: AgentConfig, 
        game_username: str, 
        game_password: str
    ):
        super().__init__(agent_config=agent_config)
        self.game_username = game_username
        self.game_password = game_password
        self.game_logged_in = False
    
    async def on_startup(self):
        """Startup: login to game"""
        ws = self.workspace()
        
        await ws.channel("general").post(
            f"🤖 {self.agent_id} starting up..."
        )
        
        # Get AgentWorld adapter
        agentworld = self.get_mod_adapter("agentworld")
        if not agentworld:
            await ws.channel("general").post(
                "❌ AgentWorld mod not available!"
            )
            return
        
        # Login to game
        await ws.channel("general").post(
            f"🎮 Logging into AgentWorld as {self.game_username}..."
        )
        
        result = await agentworld.agentworld_login(
            username=self.game_username,
            password=self.game_password
        )
        
        if result.get("success"):
            self.game_logged_in = True
            await ws.channel("general").post(
                f"✅ Logged into AgentWorld as {self.game_username}!"
            )
            
            # Do one observation
            obs = await agentworld.agentworld_observe(radius=32)
            player = obs.get("player", {})
            await ws.channel("general").post(
                f"📍 Position: ({player.get('x')}, {player.get('y')})"
            )
        else:
            error = result.get("error", "Unknown error")
            await ws.channel("general").post(
                f"❌ Login failed: {error}"
            )
    
    async def on_channel_post(self, context: ChannelMessageContext):
        """Respond to channel messages"""
        message = context.message_content.lower()
        ws = self.workspace()
        agentworld = self.get_mod_adapter("agentworld")
        
        if not agentworld or not self.game_logged_in:
            return
        
        # Check location
        if "where" in message or "location" in message:
            obs = await agentworld.agentworld_observe(radius=0)
            player = obs.get("player", {})
            x, y = player.get("x"), player.get("y")
            await ws.channel(context.channel).reply(
                context.incoming_event.id,
                f"I'm at ({x}, {y}) 📍"
            )
        
        # Check status
        elif "status" in message or "health" in message:
            obs = await agentworld.agentworld_observe(radius=0)
            player = obs.get("player", {})
            hp = f"{player.get('health')}/{player.get('max_health')}"
            level = player.get('level', '?')
            await ws.channel(context.channel).reply(
                context.incoming_event.id,
                f"Lv.{level}, HP: {hp} 💚"
            )
        
        # Move command
        elif "move to" in message:
            try:
                # Extract coordinates from message
                import re
                coords = re.findall(r'\((\d+),\s*(\d+)\)', message)
                if coords:
                    x, y = int(coords[0][0]), int(coords[0][1])
                    result = await agentworld.agentworld_move(x, y)
                    await ws.channel(context.channel).reply(
                        context.incoming_event.id,
                        f"Moving to ({x}, {y})! 🏃"
                    )
            except Exception as e:
                await ws.channel(context.channel).reply(
                    context.incoming_event.id,
                    f"Error: {str(e)}"
                )


def main():
    """Main entry point"""
    import os
    
    # Configuration
    game_username = os.environ.get("GAME_USERNAME", "bot_test1")
    game_password = os.environ.get("GAME_PASSWORD", "password")
    
    # Agent configuration
    agent_config = AgentConfig(
        instruction="You are a friendly game bot in AgentWorld.",
        model_name="gpt-4",  # or "gpt-3.5-turbo" for lower cost
        provider="openai"
    )
    
    # Create agent
    agent = SimpleGameAgent(
        agent_config=agent_config,
        game_username=game_username,
        game_password=game_password
    )
    
    # Get network configuration from arguments or use defaults
    network_host = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    network_port = int(sys.argv[2]) if len(sys.argv) > 2 else 8700
    
    # Start agent
    print(f"🚀 Starting Simple Game Agent...")
    print(f"   Network: {network_host}:{network_port}")
    print(f"   Game User: {game_username}")
    print(f"   Press Ctrl+C to stop")
    
    agent.start(network_host=network_host, network_port=network_port)
    agent.wait_for_stop()


if __name__ == "__main__":
    main()

