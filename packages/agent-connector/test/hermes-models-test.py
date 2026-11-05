"""Exercise Hermes discovery with provider APIs isolated from real credentials."""

import importlib.util
from pathlib import Path
import sys
import os
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("hermes_models", Path(__file__).parents[1] / "src" / "hermes-models.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HermesModelsTest(unittest.TestCase):
    def setUp(self):
        self.config = ModuleType("hermes_cli.config")
        self.config.load_config = lambda: {"model": {"provider": "auto", "default": "gpt-6-astra"}}
        self.auth = ModuleType("hermes_cli.auth")
        self.auth.resolve_provider = Mock(return_value="openai-codex")
        self.runtime = ModuleType("hermes_cli.runtime_provider")
        self.runtime.resolve_requested_provider = lambda: "auto"
        self.models = ModuleType("hermes_cli.models")
        self.models.cached_provider_model_ids = Mock(return_value=["gpt-6-astra", "gpt-5.5"])
        self.package = ModuleType("hermes_cli")
        self.package.models = self.models
        self.modules = patch.dict(sys.modules, {
            "hermes_cli": self.package, "hermes_cli.config": self.config,
            "hermes_cli.auth": self.auth, "hermes_cli.runtime_provider": self.runtime,
            "hermes_cli.models": self.models,
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_uses_resolved_provider_instead_of_nous_portal(self):
        def discover(provider):
            return ["gpt-6-astra", "gpt-5.5"] if provider == "openai-codex" else ["anthropic/claude-sonnet-4.6"]
        self.models.cached_provider_model_ids = discover
        self.assertEqual(helper.model_catalog(), {"provider": "openai-codex", "models": ["gpt-6-astra", "gpt-5.5"]})

    def test_switching_to_anthropic_lists_claude_instead_of_codex_models(self):
        self.auth.resolve_provider = lambda requested: "anthropic"
        self.config.load_config = lambda: {"model": {"provider": "anthropic", "default": "claude-sonnet-4-6"}}
        self.runtime.resolve_requested_provider = lambda: "anthropic"
        self.models.cached_provider_model_ids = lambda provider: ["claude-sonnet-4-6", "claude-opus-4-8"] if provider == "anthropic" else ["gpt-6-astra"]
        self.assertEqual(helper.model_catalog(), {"provider": "anthropic", "models": ["claude-sonnet-4-6", "claude-opus-4-8"]})

    def test_keeps_current_model_when_discovery_fails(self):
        self.models.cached_provider_model_ids.side_effect = RuntimeError("secret must not leave the process")
        self.assertEqual(helper.model_catalog(), {"provider": "openai-codex", "models": ["gpt-6-astra"]})

    def test_supports_hermes_without_the_new_cache_api(self):
        del self.models.cached_provider_model_ids
        self.models.provider_model_ids = lambda provider: ["gpt-5.5"]
        self.assertEqual(helper.model_catalog(), {"provider": "openai-codex", "models": ["gpt-6-astra", "gpt-5.5"]})

    def test_honors_the_sticky_active_profile_before_loading_config(self):
        profiles = ModuleType("hermes_cli.profiles")
        profiles.get_active_profile = lambda: "work"
        profiles.resolve_profile_env = lambda name: "/hermes/profiles/work"
        self.config.load_config = lambda: {"model": {"default": "work-model" if os.environ.get("HERMES_HOME") == "/hermes/profiles/work" else "wrong-root-model"}}
        self.models.cached_provider_model_ids = lambda provider: []
        with patch.dict(sys.modules, {"hermes_cli.profiles": profiles}), patch.dict(os.environ, {"HERMES_HOME": ""}):
            self.assertEqual(helper.model_catalog()["models"], ["work-model"])

    def test_keeps_an_explicit_profile_home_instead_of_following_active_profile(self):
        profiles = ModuleType("hermes_cli.profiles")
        profiles.get_active_profile = lambda: "other"
        profiles.resolve_profile_env = lambda name: "/hermes/profiles/other"
        self.config.load_config = lambda: {"model": {"default": "right-model" if os.environ.get("HERMES_HOME") == "/hermes/profiles/explicit" else "wrong-model"}}
        self.models.cached_provider_model_ids = lambda provider: []
        with patch.dict(sys.modules, {"hermes_cli.profiles": profiles}), patch.dict(os.environ, {"HERMES_HOME": "/hermes/profiles/explicit"}):
            self.assertEqual(helper.model_catalog()["models"], ["right-model"])

    def test_an_explicit_named_agent_profile_overrides_the_active_profile(self):
        profiles = ModuleType("hermes_cli.profiles")
        profiles.get_active_profile = lambda: "other"
        profiles.resolve_profile_env = lambda name: "/hermes/profiles/" + name
        self.config.load_config = lambda: {"model": {"default": os.environ.get("HERMES_HOME")}}
        self.models.cached_provider_model_ids = lambda provider: []
        with patch.dict(sys.modules, {"hermes_cli.profiles": profiles}), patch.dict(os.environ, {"HERMES_HOME": ""}):
            self.assertEqual(helper.model_catalog("coder")["models"], ["/hermes/profiles/coder"])


if __name__ == "__main__":
    unittest.main()
