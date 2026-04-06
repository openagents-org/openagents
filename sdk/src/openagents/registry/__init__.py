"""
Agent registry — YAML-based agent definitions.

Each .yaml file in this directory defines one agent type with its metadata,
install command, adapter config, env config, and readiness checks.

Use ``load_registry()`` to load all definitions into PluginInfo and AgentPlugin
objects that the rest of the system consumes.
"""

from openagents.registry.loader import load_registry_yamls, load_single_yaml

__all__ = ["load_registry_yamls", "load_single_yaml"]
