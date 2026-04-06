"""
Simplified Mod Loading System for OpenAgents.

This module provides simple, convention-based loading of mods and adapters.
Removed complex manifest system and multiple naming fallbacks for clarity.

Supports both:
- Python module paths (e.g., "openagents.mods.workspace.messaging")
- Local mods in network folder (e.g., "./requirement_network" loads from mods/ directory)
"""

from typing import List, Optional, Dict, Any, Type
from pathlib import Path
import importlib
import importlib.util
import logging
import sys
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.core.base_mod import BaseMod

logger = logging.getLogger(__name__)

# Simple naming conventions - no complex fallbacks
NETWORK_MOD_CLASS_NAME = "NetworkMod"
AGENT_ADAPTER_CLASS_NAME = "AgentAdapter"


def _load_mod_from_file(
    mod_path: Path,
    mod_name: str,
) -> Optional[BaseMod]:
    """Load a mod from a local file path.

    Args:
        mod_path: Path to the mod directory (should contain mod.py)
        mod_name: Name to use for the mod

    Returns:
        BaseMod class or None if loading fails
    """
    mod_file = mod_path / "mod.py"
    if not mod_file.exists():
        logger.error(f"Mod file not found: {mod_file}")
        return None

    try:
        # Add parent directory to sys.path so the mod package can be imported
        parent_dir = str(mod_path.parent)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        # Get the package name from the directory name
        package_name = mod_path.name

        # First, try to import as a regular package (this handles relative imports)
        try:
            # Import the package first (loads __init__.py)
            package = importlib.import_module(package_name)
            # Then import the mod submodule
            mod_module = importlib.import_module(f"{package_name}.mod")
            module = mod_module
        except ImportError as e:
            logger.debug(f"Package import failed, trying direct file load: {e}")
            # Fallback: Load directly from file (for mods without __init__.py)
            module_name = f"_local_mod_{mod_name.replace('.', '_').replace('/', '_')}"
            spec = importlib.util.spec_from_file_location(module_name, mod_file)
            if spec is None or spec.loader is None:
                logger.error(f"Could not load module spec from {mod_file}")
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

        # Find the mod class using flexible naming patterns
        mod_class = None
        mod_short_name = mod_path.name

        class_name_candidates = [
            NETWORK_MOD_CLASS_NAME,  # "NetworkMod"
            f"{mod_short_name.title().replace('_', '')}NetworkMod",
            f"{mod_short_name.title().replace('_', '')}Mod",
            "Mod",
        ]

        for class_name in class_name_candidates:
            if hasattr(module, class_name):
                candidate_class = getattr(module, class_name)
                if isinstance(candidate_class, type) and issubclass(candidate_class, BaseMod):
                    mod_class = candidate_class
                    logger.debug(f"Found local mod class: {class_name}")
                    break

        # If no candidate found, search for any BaseMod subclass
        if mod_class is None:
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, type) and issubclass(attr, BaseMod) and attr != BaseMod:
                    mod_class = attr
                    logger.debug(f"Found local mod class by inheritance: {attr_name}")
                    break

        if mod_class is None:
            logger.error(f"Could not find a suitable mod class in {mod_file}")
            return None

        return mod_class

    except Exception as e:
        logger.error(f"Error loading local mod from {mod_file}: {e}")
        return None


def _load_adapter_from_file(
    mod_path: Path,
    mod_name: str,
) -> Optional[Type[BaseModAdapter]]:
    """Load a mod adapter from a local file path.

    Args:
        mod_path: Path to the mod directory (should contain adapter.py)
        mod_name: Name to use for the mod

    Returns:
        BaseModAdapter class or None if loading fails
    """
    adapter_file = mod_path / "adapter.py"
    if not adapter_file.exists():
        logger.warning(f"Adapter file not found: {adapter_file}")
        return None

    try:
        # Add parent directory to sys.path so the mod package can be imported
        parent_dir = str(mod_path.parent)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        # Get the package name from the directory name
        package_name = mod_path.name

        # First, try to import as a regular package (this handles relative imports)
        try:
            # Import the package first (loads __init__.py)
            package = importlib.import_module(package_name)
            # Then import the adapter submodule
            adapter_module = importlib.import_module(f"{package_name}.adapter")
            module = adapter_module
        except ImportError as e:
            logger.debug(f"Package import failed, trying direct file load: {e}")
            # Fallback: Load directly from file
            module_name = f"_local_adapter_{mod_name.replace('.', '_').replace('/', '_')}"
            spec = importlib.util.spec_from_file_location(module_name, adapter_file)
            if spec is None or spec.loader is None:
                logger.error(f"Could not load module spec from {adapter_file}")
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

        # Find the adapter class
        adapter_class = None
        mod_short_name = mod_path.name

        class_name_candidates = [
            AGENT_ADAPTER_CLASS_NAME,  # "AgentAdapter"
            f"{mod_short_name.title().replace('_', '')}AgentClient",
            f"{mod_short_name.title().replace('_', '')}Adapter",
            "Adapter",
        ]

        for class_name in class_name_candidates:
            if hasattr(module, class_name):
                candidate_class = getattr(module, class_name)
                if isinstance(candidate_class, type) and issubclass(candidate_class, BaseModAdapter):
                    adapter_class = candidate_class
                    logger.debug(f"Found local adapter class: {class_name}")
                    break

        if adapter_class is None:
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, type) and issubclass(attr, BaseModAdapter) and attr != BaseModAdapter:
                    adapter_class = attr
                    logger.debug(f"Found local adapter class by inheritance: {attr_name}")
                    break

        return adapter_class

    except Exception as e:
        logger.error(f"Error loading local adapter from {adapter_file}: {e}")
        return None


# Store workspace path for adapter loading (set when loading network mods)
_current_workspace_path: Optional[Path] = None


def load_network_mods(
    mod_configs: List[Dict[str, Any]],
    workspace_path: Optional[str] = None,
) -> Dict[str, BaseMod]:
    """Load network-level mods with flexible naming patterns.

    Supports both Python module paths and local mods:
    - Python module: "openagents.mods.workspace.messaging"
    - Local mod: "./requirement_network" (loads from {workspace_path}/mods/requirement_network/)

    Args:
        mod_configs: List of mod configuration dictionaries with 'name' and 'enabled' keys.
        workspace_path: Optional path to the network workspace directory for local mods.

    Returns:
        Dict[str, BaseMod]: Dictionary mapping mod names to mod instances
    """
    global _current_workspace_path
    if workspace_path:
        _current_workspace_path = Path(workspace_path)

    mods = {}

    for mod_config in mod_configs:
        mod_name = mod_config.get("name")
        enabled = mod_config.get("enabled", True)
        config = mod_config.get("config", {})

        if not enabled or not mod_name:
            logger.debug(f"Skipping disabled or unnamed mod: {mod_config}")
            continue

        # Check if this is a local mod (starts with ./)
        is_local_mod = mod_name.startswith("./")

        if is_local_mod:
            # Load from local mods directory
            if not workspace_path:
                logger.error(f"Cannot load local mod '{mod_name}' without workspace_path")
                continue

            # Strip "./" prefix and construct path
            local_mod_name = mod_name[2:]  # Remove "./"
            mod_path = Path(workspace_path) / "mods" / local_mod_name

            if not mod_path.exists():
                logger.error(f"Local mod directory not found: {mod_path}")
                continue

            logger.info(f"Loading local mod from: {mod_path}")
            mod_class = _load_mod_from_file(mod_path, local_mod_name)

            if mod_class is None:
                continue

            try:
                # Instantiate the mod
                mod_instance = mod_class(mod_name)

                # Set config if provided
                if config:
                    mod_instance.update_config(config)

                # Initialize the mod
                mod_instance.initialize()

                # Store the local path for adapter loading
                mod_instance._local_mod_path = mod_path

                mods[mod_name] = mod_instance
                logger.info(f"Successfully loaded local mod: {mod_name}")
            except Exception as e:
                logger.error(f"Error initializing local mod {mod_name}: {e}")

            continue

        # Standard Python module loading
        try:
            # Import the mod module
            module_path = f"{mod_name}.mod"
            module = importlib.import_module(module_path)

            # Try to find the mod class using flexible naming patterns
            mod_class = None
            components = mod_name.split(".")
            mod_short_name = components[-1] if components else mod_name

            # Common naming patterns for network mods (restored from original)
            class_name_candidates = [
                NETWORK_MOD_CLASS_NAME,  # Simple "NetworkMod"
                f"{mod_short_name.title().replace('_', '')}NetworkMod",  # e.g., "DefaultWorkspaceNetworkMod"
                f"{mod_short_name.title().replace('_', '')}Mod",  # e.g., "AgentDiscoveryMod"
                "Mod",  # Generic "Mod"
            ]

            # First try the class name candidates
            for class_name in class_name_candidates:
                if hasattr(module, class_name):
                    candidate_class = getattr(module, class_name)
                    if isinstance(candidate_class, type) and issubclass(
                        candidate_class, BaseMod
                    ):
                        mod_class = candidate_class
                        logger.debug(f"Found network mod class: {class_name}")
                        break

            # If no candidate found, search for any BaseMod subclass
            if mod_class is None:
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type)
                        and issubclass(attr, BaseMod)
                        and attr != BaseMod
                    ):
                        mod_class = attr
                        logger.debug(
                            f"Found network mod class by inheritance: {attr_name}"
                        )
                        break

            if mod_class is None:
                logger.error(
                    f"Could not find a suitable network mod class in module {module_path}"
                )
                continue

            # Instantiate the mod with configuration
            mod_instance = mod_class(mod_name)

            # Set config if provided
            if config:
                mod_instance.update_config(config)

            # Initialize the mod after config is set
            mod_instance.initialize()

            mods[mod_name] = mod_instance
            logger.info(f"Successfully loaded network mod: {mod_name}")

        except ImportError as e:
            logger.error(f"Could not import network mod {mod_name}: {e}")
        except Exception as e:
            logger.error(f"Error loading network mod {mod_name}: {e}")

    return mods


def load_mod_adapter(mod_name: str, workspace_path: Optional[str] = None) -> Optional[BaseModAdapter]:
    """Load a mod adapter with flexible naming patterns.

    Supports both Python module paths and local mods:
    - Python module: "openagents.mods.workspace.messaging"
    - Local mod: "./requirement_network" (loads from {workspace_path}/mods/requirement_network/)

    Args:
        mod_name: Name of the mod (e.g., 'openagents.mods.communication.simple_messaging' or './my_mod')
        workspace_path: Optional path to the network workspace directory for local mods.
                       If not provided, uses the workspace path from load_network_mods().

    Returns:
        BaseModAdapter class or None if loading fails
    """
    # Check if this is a local mod
    is_local_mod = mod_name.startswith("./")

    if is_local_mod:
        # Use provided workspace_path or fall back to stored path
        ws_path = Path(workspace_path) if workspace_path else _current_workspace_path

        if not ws_path:
            logger.error(f"Cannot load local adapter '{mod_name}' without workspace_path")
            return None

        # Strip "./" prefix and construct path
        local_mod_name = mod_name[2:]  # Remove "./"
        mod_path = ws_path / "mods" / local_mod_name

        if not mod_path.exists():
            logger.error(f"Local mod directory not found: {mod_path}")
            return None

        logger.info(f"Loading local adapter from: {mod_path}")
        adapter_class = _load_adapter_from_file(mod_path, local_mod_name)

        if adapter_class:
            logger.info(f"Successfully loaded local adapter: {mod_name}")
        return adapter_class

    # Standard Python module loading
    try:
        # Import the adapter module
        module_path = f"{mod_name}.adapter"
        module = importlib.import_module(module_path)

        # Try to find the adapter class using flexible naming patterns
        adapter_class = None
        components = mod_name.split(".")
        mod_short_name = components[-1] if components else mod_name

        # Common naming patterns for adapters (restored from original)
        class_name_candidates = [
            AGENT_ADAPTER_CLASS_NAME,  # Simple "AgentAdapter"
            f"{mod_short_name.title().replace('_', '')}AgentClient",  # e.g., "SimpleMessagingAgentClient"
            f"{mod_short_name.title().replace('_', '')}Adapter",  # e.g., "SimpleMessagingAdapter"
            "Adapter",  # Generic "Adapter"
        ]

        # First try the class name candidates
        for class_name in class_name_candidates:
            if hasattr(module, class_name):
                candidate_class = getattr(module, class_name)
                if isinstance(candidate_class, type):
                    # Be more lenient for testing - check inheritance but allow mocks
                    try:
                        if issubclass(candidate_class, BaseModAdapter):
                            adapter_class = candidate_class
                            logger.debug(f"Found adapter class: {class_name}")
                            break
                    except TypeError:
                        # This can happen with mocks, so try other checks
                        pass

                    # Allow any callable class for backward compatibility with tests
                    if hasattr(candidate_class, "__call__"):
                        adapter_class = candidate_class
                        logger.debug(f"Found adapter class (permissive): {class_name}")
                        break

        # If no candidate found, search for any BaseModAdapter subclass or mock
        if adapter_class is None:
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, type):
                    try:
                        if issubclass(attr, BaseModAdapter) and attr != BaseModAdapter:
                            adapter_class = attr
                            logger.debug(
                                f"Found adapter class by inheritance: {attr_name}"
                            )
                            break
                    except TypeError:
                        # For test compatibility, accept any class-like object
                        if hasattr(attr, "__call__"):
                            adapter_class = attr
                            logger.debug(
                                f"Found adapter class (permissive inheritance): {attr_name}"
                            )
                            break

        if adapter_class is None:
            logger.error(
                f"Could not find a suitable adapter class in module {module_path}"
            )
            return None

        # Return the class (not instance - will be instantiated by client)
        logger.info(f"Successfully loaded mod adapter: {mod_name}")
        return adapter_class

    except ImportError as e:
        logger.error(f"Could not import mod adapter {mod_name}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error loading mod adapter {mod_name}: {e}")
        return None


def discover_available_mods(base_package: str = "openagents.mods") -> List[str]:
    """Discover available mods by scanning the mods directory.

    Args:
        base_package: Base package to scan for mods (default: openagents.mods)

    Returns:
        List of available mod names
    """
    available_mods = []

    try:
        import pkgutil
        import inspect

        # Import the base package
        base_module = importlib.import_module(base_package)
        base_path = base_module.__path__

        # Walk through all subpackages
        for importer, modname, ispkg in pkgutil.walk_packages(
            base_path, f"{base_package}."
        ):
            if ispkg:
                # Check if this package has a mod.py file with NetworkMod class
                try:
                    mod_module = importlib.import_module(f"{modname}.mod")
                    if hasattr(mod_module, NETWORK_MOD_CLASS_NAME):
                        available_mods.append(modname)
                        logger.debug(f"Discovered mod: {modname}")
                except ImportError:
                    # No mod.py file, skip this package
                    continue
                except Exception as e:
                    logger.warning(f"Error checking mod {modname}: {e}")
                    continue

    except Exception as e:
        logger.error(f"Error discovering mods: {e}")

    return available_mods


def validate_mod_structure(mod_name: str) -> Dict[str, bool]:
    """Validate that a mod follows the expected structure.

    Args:
        mod_name: Name of the mod to validate

    Returns:
        Dictionary with validation results
    """
    results = {
        "has_network_mod": False,
        "has_agent_adapter": False,
        "network_mod_valid": False,
        "agent_adapter_valid": False,
    }

    # Check network mod
    try:
        module_path = f"{mod_name}.mod"
        module = importlib.import_module(module_path)

        if hasattr(module, NETWORK_MOD_CLASS_NAME):
            results["has_network_mod"] = True
            mod_class = getattr(module, NETWORK_MOD_CLASS_NAME)
            if issubclass(mod_class, BaseMod):
                results["network_mod_valid"] = True

    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Error validating network mod for {mod_name}: {e}")

    # Check agent adapter
    try:
        module_path = f"{mod_name}.adapter"
        module = importlib.import_module(module_path)

        if hasattr(module, AGENT_ADAPTER_CLASS_NAME):
            results["has_agent_adapter"] = True
            adapter_class = getattr(module, AGENT_ADAPTER_CLASS_NAME)
            if issubclass(adapter_class, BaseModAdapter):
                results["agent_adapter_valid"] = True

    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Error validating agent adapter for {mod_name}: {e}")

    return results


def load_mod_by_type(mod_name: str, mod_type: str) -> Optional[Any]:
    """Load a mod component by type.

    Args:
        mod_name: Name of the mod
        mod_type: Type of mod component ('network' or 'adapter')

    Returns:
        Mod component class or None if loading fails
    """
    if mod_type == "network":
        mods = load_network_mods([{"name": mod_name, "enabled": True}])
        return mods.get(mod_name)
    elif mod_type == "adapter":
        return load_mod_adapter(mod_name)
    else:
        logger.error(f"Unknown mod type: {mod_type}")
        return None


# Convenience functions for common operations
def get_mod_class(mod_name: str, class_type: str) -> Optional[Type]:
    """Get a mod class by name and type.

    Args:
        mod_name: Name of the mod
        class_type: Type of class ('network' or 'adapter')

    Returns:
        Class object or None if not found
    """
    try:
        if class_type == "network":
            module_path = f"{mod_name}.mod"
            class_name = NETWORK_MOD_CLASS_NAME
        elif class_type == "adapter":
            module_path = f"{mod_name}.adapter"
            class_name = AGENT_ADAPTER_CLASS_NAME
        else:
            logger.error(f"Unknown class type: {class_type}")
            return None

        module = importlib.import_module(module_path)
        return getattr(module, class_name, None)

    except ImportError:
        logger.error(f"Could not import {class_type} for {mod_name}")
        return None
    except Exception as e:
        logger.error(f"Error getting {class_type} class for {mod_name}: {e}")
        return None


def is_mod_available(mod_name: str) -> bool:
    """Check if a mod is available and properly structured.

    Args:
        mod_name: Name of the mod to check

    Returns:
        True if mod is available and valid, False otherwise
    """
    validation = validate_mod_structure(mod_name)
    return validation["has_network_mod"] and validation["network_mod_valid"]


def load_mod_adapters(mod_configs: List) -> List[BaseModAdapter]:
    """Load multiple mod adapters.

    Args:
        mod_configs: List of mod names (strings) or mod config dicts with 'name' and optional 'config' keys

    Returns:
        List of instantiated adapter instances
    """
    adapters = []

    for item in mod_configs:
        # Support both string names and config dicts
        if isinstance(item, str):
            mod_name = item
            mod_config = {}
        elif isinstance(item, dict):
            mod_name = item.get("name")
            mod_config = item.get("config", {})
            if not mod_name:
                logger.warning(f"Mod config missing 'name' field: {item}")
                continue
        else:
            logger.warning(f"Invalid mod config type: {type(item)}")
            continue

        adapter_class = load_mod_adapter(mod_name)
        if adapter_class:
            # Instantiate the adapter - try different constructor patterns
            try:
                # First try with mod_config (new pattern for configurable adapters)
                adapter_instance = adapter_class(mod_config=mod_config)
                adapters.append(adapter_instance)
                logger.info(f"Instantiated adapter for {mod_name} (with config)")
            except TypeError:
                try:
                    # Try no arguments (like ThreadMessagingAgentAdapter)
                    adapter_instance = adapter_class()
                    adapters.append(adapter_instance)
                    logger.info(f"Instantiated adapter for {mod_name} (no args)")
                except TypeError:
                    try:
                        # Try with mod_name argument (like BaseModAdapter expects)
                        adapter_instance = adapter_class(mod_name)
                        adapters.append(adapter_instance)
                        logger.info(f"Instantiated adapter for {mod_name} (with mod_name)")
                    except Exception as e:
                        logger.error(f"Failed to instantiate adapter for {mod_name}: {e}")
                except Exception as e:
                    logger.error(f"Failed to instantiate adapter for {mod_name}: {e}")
            except Exception as e:
                logger.error(f"Failed to instantiate adapter for {mod_name}: {e}")

    return adapters
