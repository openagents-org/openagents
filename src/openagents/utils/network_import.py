"""Network import utilities for OpenAgents."""

import json
import logging
import os
import shutil
import yaml
from io import BytesIO
from pathlib import Path
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from zipfile import ZipFile, BadZipFile

from openagents.models.network_management import (
    ImportMode,
    ImportValidationResult,
    ImportPreview,
    ImportResult,
    ExportManifest
)
from openagents.models.network_config import NetworkConfig

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)


class NetworkImporter:
    """Handles importing network configuration from ZIP archive."""

    def __init__(self, network: Optional["AgentNetwork"] = None):
        """Initialize importer.
        
        Args:
            network: Optional existing AgentNetwork instance for overwrite/merge modes
        """
        self.network = network

    def validate(self, zip_file: BytesIO) -> ImportValidationResult:
        """Validate import ZIP file.
        
        Args:
            zip_file: ZIP file to validate
            
        Returns:
            ImportValidationResult: Validation result
        """
        errors = []
        warnings = []
        manifest = None
        preview = None
        
        try:
            zip_file.seek(0)
            
            # Check if valid ZIP
            try:
                with ZipFile(zip_file, 'r') as zf:
                    file_list = zf.namelist()
            except BadZipFile:
                errors.append("Invalid ZIP file format")
                return ImportValidationResult(
                    valid=False,
                    errors=errors,
                    warnings=warnings
                )
            
            # Check for path traversal
            for filename in file_list:
                if '..' in filename or filename.startswith('/'):
                    errors.append(f"Invalid file path detected: {filename}")
            
            if errors:
                return ImportValidationResult(
                    valid=False,
                    errors=errors,
                    warnings=warnings
                )
            
            # Validate required files
            if 'manifest.json' not in file_list:
                errors.append("Missing manifest.json")
            
            if 'network.yaml' not in file_list:
                errors.append("Missing network.yaml")
            
            if errors:
                return ImportValidationResult(
                    valid=False,
                    errors=errors,
                    warnings=warnings
                )
            
            # Parse and validate manifest
            with ZipFile(zip_file, 'r') as zf:
                manifest_data = json.loads(zf.read('manifest.json'))
                try:
                    manifest = ExportManifest(**manifest_data)
                except Exception as e:
                    errors.append(f"Invalid manifest format: {str(e)}")
                    return ImportValidationResult(
                        valid=False,
                        errors=errors,
                        warnings=warnings
                    )
                
                # Validate network.yaml
                try:
                    network_yaml = yaml.safe_load(zf.read('network.yaml'))
                    if 'network' not in network_yaml:
                        errors.append("network.yaml must contain 'network' key")
                    else:
                        # Try to parse as NetworkConfig
                        try:
                            NetworkConfig(**network_yaml['network'])
                        except Exception as e:
                            errors.append(f"Invalid network configuration: {str(e)}")
                except yaml.YAMLError as e:
                    errors.append(f"Invalid YAML in network.yaml: {str(e)}")
                except Exception as e:
                    errors.append(f"Error reading network.yaml: {str(e)}")
                
                # Check for unknown mods
                mod_files = [f for f in file_list if f.startswith('mods/') and f.endswith('.yaml')]
                if mod_files:
                    for mod_file in mod_files:
                        try:
                            mod_data = yaml.safe_load(zf.read(mod_file))
                            mod_name = mod_data.get('name', 'unknown')
                            # TODO: Check if mod is available in the system
                            # For now, just log as warning
                            warnings.append(f"Mod will be imported: {mod_name}")
                        except Exception as e:
                            warnings.append(f"Could not parse mod file {mod_file}: {str(e)}")
                
                # Create preview
                if not errors:
                    preview = self._create_preview(network_yaml, mod_files, manifest)
            
        except Exception as e:
            logger.error(f"Unexpected error during validation: {e}")
            errors.append(f"Validation error: {str(e)}")
        
        zip_file.seek(0)
        
        return ImportValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            manifest=manifest,
            preview=preview
        )

    async def apply(
        self,
        zip_file: BytesIO,
        mode: ImportMode,
        network: "AgentNetwork",
        new_name: Optional[str] = None
    ) -> ImportResult:
        """Apply import configuration.
        
        Args:
            zip_file: ZIP file to import
            mode: Import mode (create_new, overwrite, merge)
            network: Network instance to apply to
            new_name: Optional new network name (for create_new mode)
            
        Returns:
            ImportResult: Import result (never raises)
        """
        errors = []
        warnings = []
        network_restarted = False
        applied_config = {}
        
        try:
            # Validate first
            validation = self.validate(zip_file)
            if not validation.valid:
                return ImportResult(
                    success=False,
                    message="Validation failed",
                    errors=validation.errors,
                    warnings=validation.warnings
                )
            
            zip_file.seek(0)
            
            with ZipFile(zip_file, 'r') as zf:
                # Read network configuration
                network_yaml = yaml.safe_load(zf.read('network.yaml'))
                network_config_dict = network_yaml['network']
                
                # Apply mode-specific logic
                if mode == ImportMode.CREATE_NEW:
                    if new_name:
                        network_config_dict['name'] = new_name
                    # For create_new, we use the imported config as-is
                    final_config_dict = network_config_dict
                    
                elif mode == ImportMode.OVERWRITE:
                    # Overwrite existing config completely
                    final_config_dict = network_config_dict
                    
                elif mode == ImportMode.MERGE:
                    # Merge with existing config
                    if hasattr(network.config, 'model_dump'):
                        existing_config = network.config.model_dump(exclude_none=False)
                    elif hasattr(network.config, 'dict'):
                        existing_config = network.config.dict(exclude_none=False)
                    else:
                        existing_config = {}
                    
                    # Deep merge
                    final_config_dict = self._deep_merge(existing_config, network_config_dict)
                else:
                    return ImportResult(
                        success=False,
                        message=f"Unknown import mode: {mode}",
                        errors=[f"Unsupported mode: {mode}"]
                    )
                
                # Apply mod configurations
                mod_files = [f for f in zf.namelist() if f.startswith('mods/') and f.endswith('.yaml')]
                if mod_files:
                    for mod_file in mod_files:
                        try:
                            mod_data = yaml.safe_load(zf.read(mod_file))
                            self._apply_mod_config(final_config_dict, mod_data, mode)
                        except Exception as e:
                            warnings.append(f"Could not apply mod {mod_file}: {str(e)}")
                
                # Create new NetworkConfig
                try:
                    new_config = NetworkConfig(**final_config_dict)
                except Exception as e:
                    return ImportResult(
                        success=False,
                        message="Failed to create network configuration",
                        errors=[f"Config creation error: {str(e)}"]
                    )
                
                # Restart network with new config
                logger.info(f"Restarting network with imported configuration (mode: {mode})")

                # Check if restart method exists (for backward compatibility)
                if hasattr(network, 'restart') and callable(getattr(network, 'restart')):
                    restart_success = await network.restart(new_config=new_config)
                    network_restarted = restart_success

                    if not restart_success:
                        return ImportResult(
                            success=False,
                            message="Network restart failed",
                            errors=["Failed to restart network with new configuration"],
                            warnings=warnings
                        )
                else:
                    # Fallback: manually update config and reinitialize
                    logger.warning("Network restart method not available, using fallback approach")
                    try:
                        # Shutdown current network
                        if hasattr(network, 'shutdown') and callable(getattr(network, 'shutdown')):
                            await network.shutdown()

                        # Update config
                        network.config = new_config
                        network.network_name = new_config.name

                        # Recreate topology
                        from openagents.core.topology import NetworkMode, create_topology
                        from openagents.models.network_config import NetworkMode as ConfigNetworkMode

                        topology_mode = (
                            NetworkMode.DECENTRALIZED
                            if str(new_config.mode) == str(ConfigNetworkMode.DECENTRALIZED)
                            else NetworkMode.CENTRALIZED
                        )
                        network.topology = create_topology(topology_mode, network.network_id, new_config)

                        # Reload mods if present in new config
                        if new_config.mods:
                            from openagents.utils.mod_loaders import load_network_mods

                            mod_configs = []
                            for mod_config in new_config.mods:
                                if hasattr(mod_config, "model_dump"):
                                    mod_configs.append(mod_config.model_dump())
                                elif hasattr(mod_config, "dict"):
                                    mod_configs.append(mod_config.dict())
                                else:
                                    mod_configs.append(mod_config)

                            mods = load_network_mods(mod_configs)
                            network.mods.clear()
                            for mod_name, mod_instance in mods.items():
                                mod_instance.bind_network(network)
                                network.mods[mod_name] = mod_instance

                        # Reinitialize
                        if hasattr(network, 'initialize') and callable(getattr(network, 'initialize')):
                            restart_success = await network.initialize()
                            network_restarted = restart_success

                            if not restart_success:
                                return ImportResult(
                                    success=False,
                                    message="Network initialization failed",
                                    errors=["Failed to initialize network with new configuration"],
                                    warnings=warnings
                                )
                        else:
                            warnings.append("Could not verify network initialization")
                            network_restarted = True

                    except Exception as e:
                        logger.error(f"Fallback restart failed: {e}", exc_info=True)
                        return ImportResult(
                            success=False,
                            message="Network restart failed",
                            errors=[f"Fallback restart error: {str(e)}"],
                            warnings=warnings
                        )
                
                # Extract workspace files if present
                workspace_path = self._get_workspace_path(network)
                workspace_files_count = 0
                if workspace_path:
                    workspace_files_count, ws_warnings = self._extract_workspace_files(zf, workspace_path)
                    warnings.extend(ws_warnings)
                else:
                    logger.warning("Could not determine workspace path, skipping workspace files extraction")

                applied_config = {
                    'network_name': new_config.name,
                    'mode': new_config.mode,
                    'mods_count': len(new_config.mods) if new_config.mods else 0,
                    'workspace_files_count': workspace_files_count
                }

            return ImportResult(
                success=True,
                message=f"Import successful (mode: {mode})",
                warnings=warnings,
                network_restarted=network_restarted,
                applied_config=applied_config
            )
            
        except Exception as e:
            logger.error(f"Import failed: {e}", exc_info=True)
            return ImportResult(
                success=False,
                message="Import failed",
                errors=[str(e)],
                warnings=warnings,
                network_restarted=network_restarted
            )

    def _create_preview(
        self,
        network_yaml: Dict[str, Any],
        mod_files: list,
        manifest: ExportManifest
    ) -> ImportPreview:
        """Create import preview."""
        network_config = network_yaml.get('network', {})
        network_name = network_config.get('name', 'unknown')
        
        mods_to_add = []
        mods_to_update = []
        
        # Extract mod names from files
        for mod_file in mod_files:
            mod_name = Path(mod_file).stem
            if self.network and self.network.config.mods:
                # Check if mod exists
                existing_mod_names = [m.name for m in self.network.config.mods]
                if mod_name in existing_mod_names:
                    mods_to_update.append(mod_name)
                else:
                    mods_to_add.append(mod_name)
            else:
                mods_to_add.append(mod_name)
        
        return ImportPreview(
            network_name=network_name,
            mode=ImportMode.CREATE_NEW,  # Default preview mode
            mods_to_add=mods_to_add,
            mods_to_update=mods_to_update,
            has_network_profile=manifest.has_network_profile,
            config_changes={
                'mode': network_config.get('mode', 'unknown'),
                'transports': len(network_config.get('transports', []))
            },
            workspace_files_count=manifest.workspace_files_count
        )

    def _apply_mod_config(
        self,
        network_config: Dict[str, Any],
        mod_data: Dict[str, Any],
        mode: ImportMode
    ):
        """Apply mod configuration to network config."""
        if 'mods' not in network_config:
            network_config['mods'] = []
        
        mod_name = mod_data.get('name')
        if not mod_name:
            return
        
        existing_mods = network_config['mods']
        mod_index = None
        
        # Find existing mod
        for i, existing_mod in enumerate(existing_mods):
            if existing_mod.get('name') == mod_name:
                mod_index = i
                break
        
        if mode == ImportMode.MERGE and mod_index is not None:
            # Merge with existing mod config
            existing_mods[mod_index] = self._deep_merge(existing_mods[mod_index], mod_data)
        elif mod_index is not None:
            # Overwrite existing mod
            existing_mods[mod_index] = mod_data
        else:
            # Add new mod
            existing_mods.append(mod_data)

    def _deep_merge(self, base: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
        """Deep merge two dictionaries."""
        result = base.copy()
        
        for key, value in update.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        
        return result

    def _get_config_path(self) -> Optional[Path]:
        """Get configuration file path from existing network.

        Returns:
            Path to config file, or None if not available
        """
        # TODO: Integrate with actual config location system
        # For now, check if network has config_path attribute
        if self.network and hasattr(self.network, 'config_path'):
            return Path(self.network.config_path)

        logger.warning("Config path not available from network instance")
        return None

    def _get_workspace_path(self, network: "AgentNetwork") -> Optional[Path]:
        """Get the workspace path from the network.

        Args:
            network: Network instance

        Returns:
            Path: Workspace path or None if not available
        """
        # Try to get workspace path from config_path (directory containing network.yaml)
        if hasattr(network, 'config_path') and network.config_path:
            return Path(network.config_path).parent

        # Try to get from workspace_manager
        if hasattr(network, 'workspace_manager') and network.workspace_manager:
            return Path(network.workspace_manager.workspace_path)

        return None

    def _extract_workspace_files(
        self,
        zf: ZipFile,
        workspace_path: Path
    ) -> tuple[int, List[str]]:
        """Extract workspace files from ZIP to workspace directory.

        Args:
            zf: ZipFile to read from
            workspace_path: Path to extract files to

        Returns:
            tuple: (number of files extracted, list of warnings)
        """
        files_extracted = 0
        warnings = []

        # Get all files under workspace/ directory in the zip
        workspace_files = [
            f for f in zf.namelist()
            if f.startswith('workspace/') and not f.endswith('/')
        ]

        if not workspace_files:
            logger.info("No workspace files to extract")
            return 0, warnings

        logger.info(f"Extracting {len(workspace_files)} workspace files")

        for archive_path in workspace_files:
            try:
                # Remove 'workspace/' prefix to get relative path
                relative_path = archive_path[len('workspace/'):]

                # Security check: ensure no path traversal
                if '..' in relative_path or relative_path.startswith('/'):
                    warnings.append(f"Skipped unsafe path: {archive_path}")
                    continue

                # Build target path
                target_path = workspace_path / relative_path

                # Create parent directories if needed
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # Extract file content and write to target
                file_content = zf.read(archive_path)
                target_path.write_bytes(file_content)

                files_extracted += 1
                logger.debug(f"Extracted workspace file: {relative_path}")

            except Exception as e:
                warnings.append(f"Failed to extract {archive_path}: {str(e)}")
                logger.warning(f"Failed to extract workspace file {archive_path}: {e}")

        logger.info(f"Extracted {files_extracted} workspace files")
        return files_extracted, warnings

