from typing import List, Optional
import importlib
import logging
import json
import os
from pathlib import Path
from openagents.core.base_protocol_adapter import BaseProtocolAdapter

logger = logging.getLogger(__name__)

def load_protocol_adapters(protocol_names: List[str]) -> List[BaseProtocolAdapter]:
    """Dynamically load and instantiate protocol adapters based on protocol names.
    
    Args:
        protocol_names: List of protocol names to load adapters for.
                       Format should be 'openagents.protocols.{category}.{protocol_name}'
                       Example: 'openagents.protocols.communication.simple_messaging'
    
    Returns:
        List[BaseProtocolAdapter]: List of instantiated protocol adapter objects
    """
    adapters = []
    
    for protocol_name in protocol_names:
        try:
            # Extract the module path and expected adapter class name
            # For example, from 'openagents.protocols.communication.simple_messaging'
            # we get module_path = 'openagents.protocols.communication.simple_messaging.adapter'
            
            # Split the protocol name to get components
            components = protocol_name.split('.')
            
            # Construct the module path for the adapter
            module_path = f"{protocol_name}.adapter"
            
            # First, try to load the adapter class name from the protocol_manifest.json
            adapter_class_name = None
            try:
                # Convert the module path to a file path to find the manifest
                module_spec = importlib.util.find_spec(protocol_name)
                if module_spec and module_spec.origin:
                    protocol_dir = Path(module_spec.origin).parent
                    manifest_path = protocol_dir / "protocol_manifest.json"
                    
                    if manifest_path.exists():
                        with open(manifest_path, 'r') as f:
                            manifest_data = json.load(f)
                            adapter_class_name = manifest_data.get("agent_adapter_class")
                            logger.debug(f"Found adapter class name in manifest: {adapter_class_name}")
            except Exception as e:
                logger.warning(f"Error loading manifest for {protocol_name}: {e}")
            
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
                protocol_short_name = components[-1]
                class_name_candidates = [
                    f"{protocol_short_name.title().replace('_', '')}AgentClient",  # e.g., SimpleMessagingAgentClient
                    "Adapter",  # Generic name
                    f"{protocol_short_name.title().replace('_', '')}Adapter"  # e.g., SimpleMessagingAdapter
                ]
                
                for class_name in class_name_candidates:
                    if hasattr(module, class_name):
                        adapter_class = getattr(module, class_name)
                        logger.debug(f"Found adapter class using naming pattern: {class_name}")
                        break
                
                if adapter_class is None:
                    # If we couldn't find a class with the expected names, look for any class that inherits from BaseProtocolAdapter
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type) and issubclass(attr, BaseProtocolAdapter) and attr != BaseProtocolAdapter:
                            adapter_class = attr
                            logger.debug(f"Found adapter class by inheritance: {attr_name}")
                            break
            
            if adapter_class is None:
                logger.error(f"Could not find a suitable adapter class in module {module_path}")
                continue
            
            # Instantiate the adapter
            adapter_instance = adapter_class()
            adapters.append(adapter_instance)
            logger.info(f"Successfully loaded protocol adapter: {adapter_class.__name__} for {protocol_name}")
            
        except ImportError as e:
            logger.error(f"Failed to import adapter module for {protocol_name}: {e}")
        except Exception as e:
            logger.error(f"Error loading protocol adapter for {protocol_name}: {e}")
    
    return adapters
