"""
Simple AgentWorld Game Agent

A minimal agent that connects to the network, logs into the game,
and performs basic actions.

Usage:
    python examples/agentworld_network/simple_game_agent.py
"""

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.agent_config import AgentConfig
import asyncio
import sys


class SimpleGameAgent(WorkerAgent):
    """Simple game agent that performs basic actions in AgentWorld"""
    
    def __init__(
        self, 
        agent_config: AgentConfig, 
        game_username: str, 
        game_password: str,
        game_channel: str
    ):
        super().__init__(agent_config=agent_config)
        self.game_username = game_username
        self.game_password = game_password
        self.game_channel = game_channel
        self.game_logged_in = False
    
    async def on_startup(self):
        """Startup: login to game and perform actions"""
        ws = self.workspace()
        
        print(f"🤖 {self.agent_id} starting up...")
        
        # Get AgentWorld adapter
        agentworld = self.get_mod_adapter("openagents.mods.games.agentworld")
        if not agentworld:
            print("❌ AgentWorld mod not available!")
            print(f"Available adapters: {list(self.client.mod_adapters.keys())}")
            return
        
        # Step 1: Login to game (with channel)
        print(f"🎮 Logging into AgentWorld as {self.game_username} on channel {self.game_channel}...")
        
        result = await agentworld.agentworld_login(
            username=self.game_username,
            password=self.game_password,
            channel=self.game_channel
        )
        
        if not result.get("success"):
            error = result.get("error", "Unknown error")
            print(f"❌ Login failed: {error}")
            return
        
        self.game_logged_in = True
        print(f"✅ Logged into AgentWorld as {self.game_username} on channel {self.game_channel}!")
        
        # Wait for game server to initialize player state
        print(f"⏳ Waiting for game server to initialize...")
        await asyncio.sleep(2)
        
        # Step 2: Observe the game world
        print(f"👀 Observing the game world...")
        await asyncio.sleep(1.0)  # Delay before API call
        obs = await agentworld.agentworld_observe(radius=32)
        
        # Extract location and player status from observation
        location = obs.get("location", {})
        current_x = location.get('x', 0)
        current_y = location.get('y', 0)
        
        player_status = obs.get("playerStatus", {})
        name = player_status.get('name', 'Unknown')
        level = player_status.get('level', 1)
        hit_points = player_status.get('hitPoints', 0)
        max_hit_points = player_status.get('maxHitPoints', 0)
        mana = player_status.get('mana', 0)
        max_mana = player_status.get('maxMana', 0)
        
        print(f"\n📊 Player Status:")
        print(f"  👤 Name: {name}")
        print(f"  ⭐ Level: {level}")
        print(f"  📍 Position: ({current_x}, {current_y})")
        print(f"  💚 HP: {hit_points}/{max_hit_points}")
        print(f"  💙 Mana: {mana}/{max_mana}")
        
        # Step 3: Move left by 3 tiles
        target_x = current_x - 3
        target_y = current_y
        
        print(f"🏃 Moving to ({target_x}, {target_y})...")
        await asyncio.sleep(1.0)  # Delay before API call
        move_result = await agentworld.agentworld_move(target_x, target_y)
        
        # Print complete move result for debugging
        print("\n" + "="*50)
        print("📊 Move Result:")
        print("="*50)
        import json
        print(json.dumps(move_result, indent=2, ensure_ascii=False))
        print("="*50 + "\n")
        
        # Check if move was successful (checking both "success" field and status)
        if move_result.get("success") or move_result.get("status") == "success":
            print(f"✅ Moved to ({target_x}, {target_y})")
        else:
            error = move_result.get("error", "Unknown error")
            print(f"❌ Move failed: {error}")
            return
        
        # Step 4: Send "Hi" message in the game channel
        chat_message = "Hi"
        print(f"💬 Sending message to channel {self.game_channel}...")
        await asyncio.sleep(1.0)  # Delay before API call
        chat_result = await agentworld.agentworld_chat(self.game_channel, chat_message)
        
        # Print complete chat result for debugging
        print("\n" + "="*50)
        print("📊 Chat Result:")
        print("="*50)
        import json
        print(json.dumps(chat_result, indent=2, ensure_ascii=False))
        print("="*50 + "\n")
        
        # Check if chat was successful
        if chat_result.get("success") or chat_result.get("status") == "success":
            print(f"✅ Message sent!")
        else:
            error = chat_result.get("error", "Unknown error")
            print(f"❌ Failed to send message: {error}")
            return
        
        print("\n" + "="*50)
        print("🎉 All tasks completed successfully!")
        print("="*50)
        print("\nAgent will continue running. Press Ctrl+C to stop.")


def main():
    """Main entry point"""
    # Game credentials and channel
    game_username = "agent1"
    game_password = "qwen123456"
    game_channel = "team-alpha"
    
    # Agent configuration
    agent_config = AgentConfig(
        instruction="You are a game bot in AgentWorld.",
        model_name="gpt-4o-mini",  # Using a lightweight model
        provider="openai"
    )
    
    # Create agent
    agent = SimpleGameAgent(
        agent_config=agent_config,
        game_username=game_username,
        game_password=game_password,
        game_channel=game_channel
    )
    
    # Network configuration
    network_host = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    network_port = int(sys.argv[2]) if len(sys.argv) > 2 else 8700
    
    # Start agent
    print("🚀 Starting Simple Game Agent")
    print(f"   Network: {network_host}:{network_port}")
    print(f"   Game User: {game_username}")
    print(f"   Channel: {game_channel}")
    print(f"   Press Ctrl+C to stop\n")
    
    try:
        agent.start(network_host=network_host, network_port=network_port)
        agent.wait_for_stop()
    except KeyboardInterrupt:
        print("\n\n👋 Agent stopped by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")


if __name__ == "__main__":
    main()
