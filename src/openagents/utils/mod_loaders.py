from typing import List, Optional, Dict, Any
import importlib
import importlib.util
import logging
import json
import os
from pathlib import Path
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.core.base_mod import BaseMod

logger = logging.getLogger(__name__)

def load_network_mods(mod_configs: List[Dict[str, Any]]) -> Dict[str, BaseMod]:
    """Dynamically load and instantiate network-level mods based on configuration.
    
    Args:
        mod_configs: List of mod configuration dictionaries.
                         Each should have 'name', 'enabled', and optional 'config' keys.
    
    Returns:
        Dict[str, BaseMod]: Dictionary mapping mod names to mod instances
    """
    mods = {}
    
    for mod_config in mod_configs:
        mod_name = mod_config.get("name")
        enabled = mod_config.get("enabled", True)
        config = mod_config.get("config", {})
        
        if not enabled or not mod_name:
            logger.debug(f"Skipping disabled or unnamed mod: {mod_config}")
            continue
            
        try:
            # Extract the module path for the network mod
            # For example, from 'openagents.mods.discovery.openconvert_discovery'
            # we get module_path = 'openagents.mods.discovery.openconvert_discovery.mod'
            
            module_path = f"{mod_name}.mod"
            
            # Try to load the mod class name from the mod_manifest.json
            mod_class_name = None
            try:
                # Convert the module path to a file path to find the manifest
                module_spec = importlib.util.find_spec(mod_name)
                if module_spec and module_spec.origin:
                    mod_dir = Path(module_spec.origin).parent
                    manifest_path = mod_dir / "mod_manifest.json"
                    
                    if manifest_path.exists():
                        with open(manifest_path, 'r') as f:
                            manifest_data = json.load(f)
                            mod_class_name = manifest_data.get("network_mod_class")
                            logger.debug(f"Found network mod class name in manifest: {mod_class_name}")
            except Exception as e:
                logger.warning(f"Error loading manifest for {mod_name}: {e}")
            
            # Import the module
            module = importlib.import_module(module_path)
            
            # Try to find the mod class
            mod_class = None
            
            # First, try using the class name from the manifest
            if mod_class_name and hasattr(module, mod_class_name):
                mod_class = getattr(module, mod_class_name)
                logger.debug(f"Using mod class from manifest: {mod_class_name}")
            else:
                # If no manifest or class not found, try common naming patterns
                components = mod_name.split('.')
                mod_short_name = components[-1]
                class_name_candidates = [
                    f"{mod_short_name.title().replace('_', '')}Mod",  # e.g., OpenconvertDiscoveryMod
                    "Mod",  # Generic name
                    f"{mod_short_name.title().replace('_', '')}NetworkMod"  # e.g., OpenconvertDiscoveryNetworkMod
                ]
                
                for class_name in class_name_candidates:
                    if hasattr(module, class_name):
                        mod_class = getattr(module, class_name)
                        logger.debug(f"Found mod class using naming pattern: {class_name}")
                        break
                
                if mod_class is None:
                    # If we couldn't find a class with the expected names, look for any class that inherits from BaseMod
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type) and issubclass(attr, BaseMod) and attr != BaseMod:
                            mod_class = attr
                            logger.debug(f"Found mod class by inheritance: {attr_name}")
                            break
            
            if mod_class is None:
                logger.error(f"Could not find a suitable mod class in module {module_path}")
                continue
            
            # Instantiate the mod
            mod_instance = mod_class(mod_name)
            
            # Apply configuration if provided
            if config:
                mod_instance.update_config(config)
            
            mods[mod_name] = mod_instance
            logger.info(f"Successfully loaded network mod: {mod_class.__name__} for {mod_name}")
            
        except ImportError as e:
            logger.error(f"Failed to import mod module for {mod_name}: {e}")
        except Exception as e:
            logger.error(f"Error loading network mod for {mod_name}: {e}")
    
    return mods

def load_mod_adapters(mod_names: List[str]) -> List[BaseModAdapter]:
    """Dynamically load and instantiate mod adapters based on mod names.
    
    Args:
        mod_names: List of mod names to load adapters for.
                       Format should be 'openagents.mods.{category}.{mod_name}'
                       Example: 'openagents.mods.communication.simple_messaging'
    
    Returns:
        List[BaseModAdapter]: List of instantiated mod adapter objects
    """
    adapters = []
    
    for mod_name in mod_names:
        try:
            # Extract the module path and expected adapter class name
            # For example, from 'openagents.mods.communication.simple_messaging'
            # we get module_path = 'openagents.mods.communication.simple_messaging.adapter'
            
            # Split the mod name to get components
            components = mod_name.split('.')
            
            # Construct the module path for the adapter
            module_path = f"{mod_name}.adapter"
            
            # First, try to load the adapter class name from the mod_manifest.json
            adapter_class_name = None
            try:
                # Convert the module path to a file path to find the manifest
                module_spec = importlib.util.find_spec(mod_name)
                if module_spec and module_spec.origin:
                    mod_dir = Path(module_spec.origin).parent
                    manifest_path = mod_dir / "mod_manifest.json"
                    
                    if manifest_path.exists():
                        with open(manifest_path, 'r') as f:
                            manifest_data = json.load(f)
                            adapter_class_name = manifest_data.get("agent_adapter_class")
                            logger.debug(f"Found adapter class name in manifest: {adapter_class_name}")
            except Exception as e:
                logger.warning(f"Error loading manifest for {mod_name}: {e}")
            
            # Import the module
            module = importlib.import_module(module_path)
            
            # Try to find the adapter class
            adapter_class = None
            
            # First, try using the class name from the manifest
            if adapter_class_name and hasattr(module, adapter_class_name):
                adapter_class = getattr(module, adapter_class_name)
                logger.debug(f"Using adapter class from manifest: {adapter_class_name}")
            else:
                # If no manifest or class not found, try common naming patterns
                mod_short_name = components[-1]
                class_name_candidates = [
                    f"{mod_short_name.title().replace('_', '')}AgentClient",  # e.g., SimpleMessagingAgentClient
                    "Adapter",  # Generic name
                    f"{mod_short_name.title().replace('_', '')}Adapter"  # e.g., SimpleMessagingAdapter
                ]
                
                for class_name in class_name_candidates:
                    if hasattr(module, class_name):
                        adapter_class = getattr(module, class_name)
                        logger.debug(f"Found adapter class using naming pattern: {class_name}")
                        break
                
                if adapter_class is None:
                    # If we couldn't find a class with the expected names, look for any class that inherits from BaseModAdapter
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type) and issubclass(attr, BaseModAdapter) and attr != BaseModAdapter:
                            adapter_class = attr
                            logger.debug(f"Found adapter class by inheritance: {attr_name}")
                            break
            
            if adapter_class is None:
                logger.error(f"Could not find a suitable adapter class in module {module_path}")
                continue
            
            # Instantiate the adapter
            adapter_instance = adapter_class()
            adapters.append(adapter_instance)
            logger.info(f"Successfully loaded mod adapter: {adapter_class.__name__} for {mod_name}")
            
        except ImportError as e:
            logger.error(f"Failed to import adapter module for {mod_name}: {e}")
        except Exception as e:
            logger.error(f"Error loading mod adapter for {mod_name}: {e}")
    
    return adapters