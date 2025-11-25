"""
Mod UI Discovery and Loading System.

This module provides utilities to discover and load mod UI components
that are co-located with mod backend code.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
import importlib.util

from openagents.models.manifest import ModManifest, ModUIConfig

logger = logging.getLogger(__name__)


def discover_mod_ui(mod_path: Path) -> Optional[ModUIConfig]:
    """
    Discover UI configuration for a mod.
    
    Args:
        mod_path: Path to the mod directory
        
    Returns:
        ModUIConfig if UI is found, None otherwise
    """
    ui_dir = mod_path / "ui"
    
    if not ui_dir.exists() or not ui_dir.is_dir():
        return None
    
    # Check for pre-built dist directory
    dist_dir = ui_dir / "dist"
    if not dist_dir.exists() or not dist_dir.is_dir():
        logger.debug(f"No dist directory found for mod UI at {ui_dir}")
        return None
    
    # Look for entry point files (common patterns)
    entry_candidates = [
        "index.js",
        "main.js",
        "bundle.js",
        "index.mjs",
    ]
    
    entry_file = None
    for candidate in entry_candidates:
        candidate_path = dist_dir / candidate
        if candidate_path.exists():
            entry_file = f"ui/dist/{candidate}"
            break
    
    if not entry_file:
        logger.warning(f"No entry file found in {dist_dir}")
        return None
    
    # Try to load manifest to get UI config
    manifest_path = mod_path / "mod_manifest.json"
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)
            
            # Check if UI config is in manifest
            if "ui" in manifest_data:
                ui_data = manifest_data["ui"]
                # Validate entry path
                if "entry" in ui_data:
                    entry_file = ui_data["entry"]
                
                try:
                    return ModUIConfig(**ui_data)
                except Exception as e:
                    logger.warning(f"Failed to parse UI config from manifest: {e}")
        except Exception as e:
            logger.warning(f"Failed to load manifest: {e}")
    
    # Default UI config if not in manifest
    return ModUIConfig(
        enabled=True,
        entry=entry_file,
        route=f"/{mod_path.name}",
    )


def get_mod_ui_path(mod_name: str, base_package: str = "openagents.mods") -> Optional[Path]:
    """
    Get the filesystem path for a mod's UI directory.
    
    Args:
        mod_name: Full mod name (e.g., "openagents.mods.workspace.wiki")
        base_package: Base package name
        
    Returns:
        Path to mod directory if found, None otherwise
    """
    try:
        # Import the mod module to get its path
        mod_module = importlib.import_module(mod_name)
        if hasattr(mod_module, "__file__") and mod_module.__file__:
            mod_file_path = Path(mod_module.__file__)
            # Get the directory containing mod.py
            mod_dir = mod_file_path.parent
            return mod_dir
    except ImportError as e:
        logger.debug(f"Could not import mod {mod_name}: {e}")
        return None
    
    return None


def discover_all_mod_uis(base_package: str = "openagents.mods") -> Dict[str, ModUIConfig]:
    """
    Discover UI configurations for all installed mods.
    
    Args:
        base_package: Base package to scan for mods
        
    Returns:
        Dictionary mapping mod names to their UI configs
    """
    mod_uis: Dict[str, ModUIConfig] = {}
    
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
                # Check if this package has a mod.py file
                try:
                    mod_module = importlib.import_module(f"{modname}.mod")
                    if hasattr(mod_module, "__file__") and mod_module.__file__:
                        mod_path = Path(mod_module.__file__).parent
                        
                        # Discover UI
                        ui_config = discover_mod_ui(mod_path)
                        if ui_config:
                            mod_uis[modname] = ui_config
                            logger.debug(f"Discovered UI for mod: {modname}")
                except ImportError:
                    # No mod.py file, skip
                    continue
                except Exception as e:
                    logger.warning(f"Error checking mod {modname} for UI: {e}")
                    continue
    
    except Exception as e:
        logger.error(f"Error discovering mod UIs: {e}")
    
    return mod_uis


def get_mod_ui_static_path(mod_name: str, base_package: str = "openagents.mods") -> Optional[Path]:
    """
    Get the path to a mod's pre-built UI static files.
    
    Args:
        mod_name: Full mod name
        base_package: Base package name
        
    Returns:
        Path to ui/dist directory if found, None otherwise
    """
    mod_path = get_mod_ui_path(mod_name, base_package)
    if not mod_path:
        return None
    
    ui_dist = mod_path / "ui" / "dist"
    if ui_dist.exists() and ui_dist.is_dir():
        return ui_dist
    
    return None

