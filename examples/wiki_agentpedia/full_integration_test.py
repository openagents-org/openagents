"""
完整的 Agentpedia 后端集成测试脚本

此脚本测试所有 8 个 Agentpedia API 端点，用于与后端服务进行联调。

使用方法:
    python examples/full_integration_test.py

环境要求:
    - OpenAgents 网络已启动（network_with_agentpedia.yaml）
    - 环境变量 AGENTPEDIA_API_KEY 已设置
    - 后端服务运行在 http://127.0.0.1:8000
"""

import asyncio
import logging
import time
from datetime import datetime
from openagents.core.client import AgentClient
from openagents.models.event import Event, EventVisibility

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


class IntegrationTester:
    """集成测试类"""
    
    def __init__(self, network_host="127.0.0.1", network_port=8700, admin_password_hash=None):
        self.network_host = network_host
        self.network_port = network_port
        self.admin_password_hash = admin_password_hash
        self.client = None
        self.test_results = {}
        self.test_path_prefix = f"test/integration-{int(time.time())}"
        
    async def setup(self):
        """设置测试环境"""
        logger.info("=" * 60)
        logger.info("Agentpedia Backend Integration Test")
        logger.info("=" * 60)
        
        agent_id = f"integration_tester_{int(time.time())}"
        self.client = AgentClient(agent_id=agent_id)
        
        logger.info(f"Connecting agent {agent_id} to network...")
        
        try:
            success = await self.client.connect_to_server(
                network_host=self.network_host,
                network_port=self.network_port,
                password_hash=self.admin_password_hash
            )
            
            if not success:
                logger.error("❌ Failed to connect to network")
                return False
            
            logger.info("✅ Connected to network")
            
            # Wait for mods to initialize
            await asyncio.sleep(2)
            
            return True
        except Exception as e:
            logger.error(f"❌ Failed to connect: {e}")
            return False
    
    async def cleanup(self):
        """清理测试环境"""
        if self.client:
            logger.info("Disconnecting agent...")
            await self.client.disconnect()
            logger.info("✅ Agent disconnected")
    
    async def send_tool_event(self, event_name: str, payload: dict, timeout: float = 10.0):
        """发送工具事件并等待响应"""
        try:
            # 创建 Event 对象
            event = Event(
                event_name=event_name,
                source_id=self.client.agent_id,
                payload=payload,
                relevant_mod="openagents.mods.external.agentpedia",
                visibility=EventVisibility.MOD_ONLY
            )
            
            # 发送事件并等待响应
            response = await asyncio.wait_for(
                self.client.send_event(event),
                timeout=timeout
            )
            
            # 解析响应
            if response and response.data:
                return response.data
            elif response:
                return {"ok": False, "error": response.message or "No response data"}
            else:
                return {"ok": False, "error": "No response received"}
                
        except asyncio.TimeoutError:
            return {"ok": False, "error": f"Timeout waiting for {event_name} response"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    
    def log_result(self, test_name: str, result: dict):
        """记录测试结果"""
        self.test_results[test_name] = result
        
        if result.get('ok'):
            logger.info(f"✅ {test_name}: SUCCESS")
            if 'data' in result:
                logger.info(f"   Data: {result['data']}")
        else:
            logger.error(f"❌ {test_name}: FAILED")
            logger.error(f"   Error: {result.get('error', 'Unknown error')}")
            if 'status_code' in result:
                logger.error(f"   Status Code: {result['status_code']}")
    
    async def test_1_create_page(self):
        """测试 1: 创建页面"""
        logger.info("\n--- Test 1: Create Page ---")
        
        path = f"{self.test_path_prefix}/test-page"
        result = await self.send_tool_event(
            "agentpedia.page.create",
            {
                "path": path,
                "title": "Integration Test Page",
                "content": "# Integration Test\n\nThis page was created by the integration test.",
                "category": "testing",
                "tags": ["integration", "test", "automated"]
            }
        )
        
        self.log_result("Create Page", result)
        return result.get('ok', False)
    
    async def test_2_get_page(self):
        """测试 2: 获取页面"""
        logger.info("\n--- Test 2: Get Page ---")
        
        path = f"{self.test_path_prefix}/test-page"
        result = await self.send_tool_event(
            "agentpedia.page.get",
            {"path": path}
        )
        
        self.log_result("Get Page", result)
        
        # 验证内容
        if result.get('ok') and 'data' in result:
            page_data = result['data']
            if page_data.get('title') == "Integration Test Page":
                logger.info("   ✓ Page title matches")
            else:
                logger.warning(f"   ⚠ Title mismatch: {page_data.get('title')}")
        
        return result.get('ok', False)
    
    async def test_3_edit_page(self):
        """测试 3: 编辑页面"""
        logger.info("\n--- Test 3: Edit Page ---")
        
        path = f"{self.test_path_prefix}/test-page"
        result = await self.send_tool_event(
            "agentpedia.page.edit",
            {
                "path": path,
                "content": "# Integration Test (Updated)\n\nThis page was updated by the integration test at " + datetime.now().isoformat(),
                "edit_summary": "Updated by integration test"
            }
        )
        
        self.log_result("Edit Page", result)
        return result.get('ok', False)
    
    async def test_4_search_pages(self):
        """测试 4: 搜索页面"""
        logger.info("\n--- Test 4: Search Pages ---")
        
        result = await self.send_tool_event(
            "agentpedia.pages.search",
            {
                "query": "integration test",
                "limit": 10
            }
        )
        
        self.log_result("Search Pages", result)
        
        # 检查搜索结果
        if result.get('ok') and 'data' in result:
            results = result['data'].get('results', [])
            logger.info(f"   Found {len(results)} results")
            
            # 验证我们创建的页面是否在搜索结果中
            our_page = any(r.get('path', '').startswith(self.test_path_prefix) for r in results)
            if our_page:
                logger.info("   ✓ Our test page found in search results")
            else:
                logger.warning("   ⚠ Our test page not found in search results")
        
        return result.get('ok', False)
    
    async def test_5_list_pages(self):
        """测试 5: 列出页面"""
        logger.info("\n--- Test 5: List Pages ---")
        
        result = await self.send_tool_event(
            "agentpedia.pages.list",
            {
                "category": "testing",
                "limit": 20
            }
        )
        
        self.log_result("List Pages", result)
        
        # 检查列表结果
        if result.get('ok') and 'data' in result:
            pages = result['data'].get('pages', [])
            logger.info(f"   Found {len(pages)} pages in 'testing' category")
        
        return result.get('ok', False)
    
    async def test_6_get_history(self):
        """测试 6: 获取页面历史"""
        logger.info("\n--- Test 6: Get Page History ---")
        
        path = f"{self.test_path_prefix}/test-page"
        result = await self.send_tool_event(
            "agentpedia.page.history",
            {
                "path": path,
                "limit": 5
            }
        )
        
        self.log_result("Get Page History", result)
        
        # 检查历史记录
        if result.get('ok') and 'data' in result:
            history = result['data'].get('history', [])
            logger.info(f"   Found {len(history)} history entries")
            
            # 应该至少有 2 条记录（创建 + 编辑）
            if len(history) >= 2:
                logger.info("   ✓ History contains create and edit entries")
            else:
                logger.warning(f"   ⚠ Expected at least 2 history entries, got {len(history)}")
        
        return result.get('ok', False)
    
    async def test_7_propose_edit(self):
        """测试 7: 提议编辑"""
        logger.info("\n--- Test 7: Propose Edit ---")
        
        path = f"{self.test_path_prefix}/test-page"
        result = await self.send_tool_event(
            "agentpedia.proposal.create",
            {
                "path": path,
                "content": "# Proposed Content\n\nThis is a proposed edit for testing.",
                "rationale": "Testing the proposal system in integration test"
            }
        )
        
        self.log_result("Propose Edit", result)
        
        # 保存 proposal_id 供下一个测试使用
        if result.get('ok') and 'data' in result:
            self.proposal_id = result['data'].get('id')
            logger.info(f"   Proposal ID: {self.proposal_id}")
        
        return result.get('ok', False)
    
    async def test_8_resolve_proposal(self):
        """测试 8: 处理提议"""
        logger.info("\n--- Test 8: Resolve Proposal ---")
        
        if not hasattr(self, 'proposal_id') or not self.proposal_id:
            logger.warning("   ⚠ No proposal ID from previous test, skipping")
            self.test_results["Resolve Proposal"] = {"ok": False, "error": "No proposal ID"}
            return False
        
        result = await self.send_tool_event(
            "agentpedia.proposal.resolve",
            {
                "proposal_id": self.proposal_id,
                "action": "approve",
                "comments": "Approved by integration test"
            }
        )
        
        self.log_result("Resolve Proposal", result)
        return result.get('ok', False)
    
    async def run_all_tests(self):
        """运行所有测试"""
        # 设置
        if not await self.setup():
            return False
        
        try:
            # 按顺序运行所有测试
            tests = [
                self.test_1_create_page,
                self.test_2_get_page,
                self.test_3_edit_page,
                self.test_4_search_pages,
                self.test_5_list_pages,
                self.test_6_get_history,
                self.test_7_propose_edit,
                self.test_8_resolve_proposal,
            ]
            
            for test in tests:
                await test()
                await asyncio.sleep(0.5)  # 给服务器一点处理时间
            
            # 汇总结果
            logger.info("\n" + "=" * 60)
            logger.info("Test Summary")
            logger.info("=" * 60)
            
            total = len(self.test_results)
            passed = sum(1 for r in self.test_results.values() if r.get('ok'))
            failed = total - passed
            
            logger.info(f"Total:  {total}")
            logger.info(f"Passed: {passed} ✅")
            logger.info(f"Failed: {failed} ❌")
            logger.info(f"Success Rate: {(passed/total*100):.1f}%")
            
            logger.info("\nDetailed Results:")
            for test_name, result in self.test_results.items():
                status = "✅ PASS" if result.get('ok') else "❌ FAIL"
                logger.info(f"  {status} - {test_name}")
                if not result.get('ok'):
                    logger.info(f"         Error: {result.get('error', 'Unknown')}")
            
            logger.info("=" * 60)
            
            return passed == total
            
        finally:
            await self.cleanup()


async def main():
    """主函数"""
    import os
    
    # 检查环境变量
    api_key = os.getenv("AGENTPEDIA_API_KEY")
    if not api_key:
        logger.warning("⚠️  Environment variable AGENTPEDIA_API_KEY is not set")
        logger.warning("   The tests may fail if the backend requires authentication")
        logger.warning("   Set it with: $env:AGENTPEDIA_API_KEY = \"your-api-key\"")
        print()
    
    # 运行测试
    tester = IntegrationTester(
        network_host="127.0.0.1",
        network_port=8700,
        admin_password_hash="admin123_hash"  # 如果需要
    )
    
    success = await tester.run_all_tests()
    
    if success:
        logger.info("\n🎉 All integration tests passed!")
        return 0
    else:
        logger.error("\n❌ Some integration tests failed")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)

