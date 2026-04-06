#!/usr/bin/env python3
"""
Test script for AgentWorld Network

This script tests the AgentWorld mod integration by:
1. Loading the network configuration
2. Verifying mod registration
3. Checking adapter availability
4. Testing basic mod functionality
"""

import asyncio
import sys
from pathlib import Path

# Add src to path for development
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from openagents.launchers.network_launcher import load_network_config
from openagents.utils.mod_loaders import load_network_mods, load_mod_adapter


def test_configuration():
    """Test 1: Configuration Loading"""
    print("\n" + "="*60)
    print("Test 1: 配置文件加载测试")
    print("="*60)
    
    try:
        config = load_network_config('sdk/examples/agentworld_network/network.yaml')
        print(f"✅ 配置加载成功!")
        print(f"   Network: {config.network.name}")
        print(f"   Node ID: {config.network.node_id}")
        print(f"   Mode: {config.network.mode}")
        print(f"   Transports: {[str(t.type) for t in config.network.transports]}")
        print(f"   Mods配置: {[m.name for m in config.network.mods]}")
        return config
    except Exception as e:
        print(f"❌ 配置加载失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_mod_loading(config):
    """Test 2: Network Mod Loading"""
    print("\n" + "="*60)
    print("Test 2: Network Mod 加载测试")
    print("="*60)
    
    try:
        # Convert Pydantic models to dicts
        mod_configs = [mod.model_dump() for mod in config.network.mods]
        mods = load_network_mods(mod_configs)
        print(f"✅ 成功加载 {len(mods)} 个 mods:")
        
        for mod_name, mod_instance in mods.items():
            print(f"\n   Mod: {mod_name}")
            print(f"   Class: {mod_instance.__class__.__name__}")
            print(f"   Module: {mod_instance.__class__.__module__}")
            
            # Check AgentWorld mod specifically
            if "agentworld" in mod_name:
                print(f"   🎮 AgentWorld Mod 详情:")
                print(f"      - Server: {getattr(mod_instance, 'game_server_host', 'N/A')}:{getattr(mod_instance, 'game_server_port', 'N/A')}")
                print(f"      - Client Port: {getattr(mod_instance, 'game_client_port', 'N/A')}")
        
        return mods
    except Exception as e:
        print(f"❌ Mod加载失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_adapter_loading():
    """Test 3: Agent Adapter Loading"""
    print("\n" + "="*60)
    print("Test 3: Agent Adapter 加载测试")
    print("="*60)
    
    try:
        adapter_class = load_mod_adapter("openagents.mods.games.agentworld")
        if adapter_class:
            print(f"✅ AgentWorld Adapter Class 加载成功!")
            print(f"   Class: {adapter_class.__name__}")
            print(f"   Module: {adapter_class.__module__}")
            
            # Instantiate the adapter
            adapter = adapter_class()
            print(f"   Instance: {adapter.__class__.__name__}")
            print(f"   Mod Name: {adapter.mod_name}")
            
            # Get tools
            tools = adapter.get_tools()
            print(f"\n   提供的工具 ({len(tools)} 个):")
            for tool in tools:
                print(f"      - {tool.name}: {tool.description[:60]}...")
            
            return adapter
        else:
            print(f"❌ Adapter加载失败: 返回 None")
            return None
    except Exception as e:
        print(f"❌ Adapter加载失败: {e}")
        import traceback
        traceback.print_exc()
        return None


async def test_mod_initialization(mods):
    """Test 4: Mod Initialization"""
    print("\n" + "="*60)
    print("Test 4: Mod 初始化测试")
    print("="*60)
    
    agentworld_mod = mods.get("openagents.mods.games.agentworld")
    if not agentworld_mod:
        print("❌ 未找到 AgentWorld mod")
        return False
    
    try:
        # Note: config is already set during mod loading
        # Just check that the mod was initialized properly
        print("✅ AgentWorld Mod 已加载!")
        print(f"   Server配置: {agentworld_mod.game_server_host}:{agentworld_mod.game_server_port}")
        print(f"   Client配置: {agentworld_mod.game_client_port}")
        print(f"   统计信息: {agentworld_mod.get_statistics()}")
        return True
    except Exception as e:
        print(f"❌ Mod检查失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_adapter_initialization(adapter):
    """Test 5: Adapter Initialization"""
    print("\n" + "="*60)
    print("Test 5: Adapter 初始化测试")
    print("="*60)
    
    try:
        # Bind agent (set agent_id)
        adapter.bind_agent("test_agent_001")
        
        # Set configuration
        adapter.config = {
            "game_server_host": "localhost",
            "game_server_port": 7031
        }
        
        # Initialize
        success = adapter.initialize()
        if success:
            print("✅ Adapter 初始化成功!")
            print(f"   Agent ID: {adapter.agent_id}")
            print(f"   Server: {adapter.game_server_host}:{adapter.game_server_port}")
            return True
        else:
            print("❌ Adapter初始化返回 False")
            return False
    except Exception as e:
        print(f"❌ Adapter初始化失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_game_server_connectivity():
    """Test 6: Game Server Connectivity (Optional)"""
    print("\n" + "="*60)
    print("Test 6: 游戏服务器连接测试 (可选)")
    print("="*60)
    
    try:
        import requests
        response = requests.get("http://localhost:7031/health", timeout=2)
        if response.status_code == 200:
            print("✅ 游戏服务器在线!")
            print(f"   URL: http://localhost:7031")
            return True
        else:
            print(f"⚠️  游戏服务器响应异常: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("⚠️  游戏服务器未运行 (这是正常的，如果你还没启动游戏服务器)")
        print("   要启动游戏服务器，请参考 AgentWorld 文档")
        return False
    except Exception as e:
        print(f"⚠️  无法连接游戏服务器: {e}")
        return False


def print_summary(results):
    """Print test summary"""
    print("\n" + "="*60)
    print("测试总结")
    print("="*60)
    
    total = len(results)
    passed = sum(1 for r in results if r)
    failed = total - passed
    
    print(f"\n总计: {total} 个测试")
    print(f"✅ 通过: {passed}")
    print(f"❌ 失败: {failed}")
    
    if failed == 0:
        print("\n🎉 所有测试通过！AgentWorld mod 集成成功！")
        print("\n下一步:")
        print("1. 启动 AgentWorld 游戏服务器")
        print("   cd /path/to/agentworld && yarn dev")
        print("\n2. 启动 OpenAgents 网络")
        print("   openagents network start sdk/examples/agentworld_network")
        print("\n3. 运行测试 agent")
        print("   python sdk/examples/agentworld_network/simple_game_agent.py")
    else:
        print("\n⚠️  部分测试失败，请检查上述错误信息")
    
    return failed == 0


async def main():
    """Main test runner"""
    print("\n" + "="*60)
    print("AgentWorld Network 集成测试")
    print("="*60)
    
    results = []
    
    # Test 1: Configuration
    config = test_configuration()
    results.append(config is not None)
    if not config:
        print("\n❌ 配置加载失败，终止测试")
        return False
    
    # Test 2: Mod Loading
    mods = test_mod_loading(config)
    results.append(mods is not None and len(mods) > 0)
    if not mods:
        print("\n❌ Mod加载失败，终止测试")
        return False
    
    # Test 3: Adapter Loading
    adapter = test_adapter_loading()
    results.append(adapter is not None)
    
    # Test 4: Mod Initialization
    if mods:
        mod_init_result = await test_mod_initialization(mods)
        results.append(mod_init_result)
    
    # Test 5: Adapter Initialization
    if adapter:
        adapter_init_result = await test_adapter_initialization(adapter)
        results.append(adapter_init_result)
    
    # Test 6: Game Server (Optional)
    game_server_result = test_game_server_connectivity()
    results.append(game_server_result)
    
    # Summary
    return print_summary(results)


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)

