"""
Persistence Manager for OpenAgents

Provides directory-based persistence infrastructure for mods and global network state.
Each mod is responsible for its own persistence logic using the provided directory structure.
"""

import sqlite3
import json
import os
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from datetime import datetime

logger = logging.getLogger(__name__)


class PersistenceManager:
    """
    Manages persistent storage infrastructure for OpenAgents networks.
    
    This class provides directory interfaces and basic database functionality,
    allowing mods to implement their own persistence logic while maintaining
    a consistent storage structure.
    """
    
    def __init__(self, workspace_dir: str):
        """Initialize persistence manager with workspace directory.
        
        Args:
            workspace_dir: Path to workspace directory for storing persistent data
        """
        self.workspace_dir = Path(workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        
        # Core directories
        self.global_dir = self.workspace_dir / "global"
        self.mods_dir = self.workspace_dir / "mods"
        
        # Create core directories
        self.global_dir.mkdir(exist_ok=True)
        self.mods_dir.mkdir(exist_ok=True)
        
        # Global database for network-level metadata
        self.db_path = self.global_dir / "network.db"
        self._init_global_database()
        
        logger.info(f"Initialized persistence manager with workspace: {self.workspace_dir}")
    
    def _init_global_database(self):
        """Initialize global SQLite database for network-level metadata."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            
            # Network metadata table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS network_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Basic agent registry (lightweight - mods can extend with their own tables)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agent_registry (
                    agent_id TEXT PRIMARY KEY,
                    metadata TEXT,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
        
        logger.info("Global database initialized successfully")
    
    # ========================================
    # Directory Interface Methods
    # ========================================
    
    def mod_data_dir(self, mod_name: str) -> Path:
        """Get the data directory for a specific mod.
        
        Args:
            mod_name: Name of the mod (e.g., 'thread_messaging', 'shared_document')
            
        Returns:
            Path: Directory path for the mod's persistent data
        """
        # Sanitize mod name for filesystem
        safe_mod_name = mod_name.replace(".", "_").replace("/", "_")
        mod_dir = self.mods_dir / safe_mod_name
        mod_dir.mkdir(exist_ok=True)
        return mod_dir
    
    def global_data_dir(self) -> Path:
        """Get the global data directory for network-level information.
        
        Returns:
            Path: Directory path for global network data
        """
        return self.global_dir
    
    def get_workspace_path(self, *path_components: str) -> Path:
        """Get a path within the workspace directory.
        
        Args:
            *path_components: Path components to join
            
        Returns:
            Path: Full path within workspace
        """
        return self.workspace_dir.joinpath(*path_components)
    
    # ========================================
    # Global Network Metadata Methods
    # ========================================
    
    def set_network_metadata(self, key: str, value: Any):
        """Set network-level metadata value.
        
        Args:
            key: Metadata key
            value: Metadata value (will be JSON serialized)
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO network_metadata (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (key, json.dumps(value)))
            conn.commit()
    
    def get_network_metadata(self, key: str, default: Any = None) -> Any:
        """Get network-level metadata value.
        
        Args:
            key: Metadata key
            default: Default value if key not found
            
        Returns:
            Metadata value or default
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM network_metadata WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
            return default
    
    def list_network_metadata(self) -> Dict[str, Any]:
        """Get all network-level metadata.
        
        Returns:
            Dictionary of all metadata key-value pairs
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM network_metadata")
            return {row[0]: json.loads(row[1]) for row in cursor.fetchall()}
    
    # ========================================
    # Basic Agent Registry Methods
    # ========================================
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]):
        """Register an agent in the global registry.
        
        Args:
            agent_id: Agent identifier
            metadata: Agent metadata
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO agent_registry (agent_id, metadata, last_seen, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """, (agent_id, json.dumps(metadata)))
            conn.commit()
    
    def unregister_agent(self, agent_id: str):
        """Mark agent as inactive in the global registry.
        
        Args:
            agent_id: Agent identifier
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agent_registry SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
                WHERE agent_id = ?
            """, (agent_id,))
            conn.commit()
    
    def get_active_agents(self) -> List[Dict[str, Any]]:
        """Get all active agents from the global registry.
        
        Returns:
            List of agent information dictionaries
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT agent_id, metadata, last_seen, created_at
                FROM agent_registry WHERE status = 'active'
            """)
            agents = []
            for row in cursor.fetchall():
                agents.append({
                    'agent_id': row[0],
                    'metadata': json.loads(row[1]) if row[1] else {},
                    'last_seen': row[2],
                    'created_at': row[3]
                })
            return agents
    
    # ========================================
    # Utility Methods
    # ========================================
    
    def get_database_path(self, mod_name: Optional[str] = None) -> Path:
        """Get database path for a mod or global database.
        
        Args:
            mod_name: Mod name (None for global database)
            
        Returns:
            Path to the database file
        """
        if mod_name:
            return self.mod_data_dir(mod_name) / f"{mod_name.split('.')[-1]}.db"
        else:
            return self.db_path
    
    def cleanup_inactive_data(self, days_old: int = 30):
        """Clean up old inactive data.
        
        Args:
            days_old: Remove data older than this many days
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM agent_registry 
                WHERE status = 'inactive' 
                AND updated_at < datetime('now', '-{} days')
            """.format(days_old))
            conn.commit()
            logger.info(f"Cleaned up agent registry data older than {days_old} days")
    
    def get_storage_stats(self) -> Dict[str, Any]:
        """Get storage statistics.
        
        Returns:
            Dictionary with storage statistics
        """
        stats = {
            'workspace_dir': str(self.workspace_dir),
            'global_dir': str(self.global_dir),
            'mods_dir': str(self.mods_dir),
            'global_db_size': self.db_path.stat().st_size if self.db_path.exists() else 0,
            'total_size': sum(f.stat().st_size for f in self.workspace_dir.rglob('*') if f.is_file()),
            'mod_directories': [d.name for d in self.mods_dir.iterdir() if d.is_dir()],
            'active_agents': len(self.get_active_agents())
        }
        
        # Add network metadata count
        stats['network_metadata_count'] = len(self.list_network_metadata())
        
        return stats


# ========================================
# Mod Persistence Helper Base Class
# ========================================

class ModPersistenceHelper:
    """
    Helper class that mods can inherit from or use as a reference
    for implementing their own persistence logic.
    """
    
    def __init__(self, mod_name: str, persistence_manager: PersistenceManager):
        """Initialize mod persistence helper.
        
        Args:
            mod_name: Name of the mod
            persistence_manager: The network's persistence manager
        """
        self.mod_name = mod_name
        self.persistence_manager = persistence_manager
        self.data_dir = persistence_manager.mod_data_dir(mod_name)
        self.db_path = self.data_dir / f"{mod_name.split('.')[-1]}.db"
    
    def init_database(self, schema_sql: str):
        """Initialize mod-specific database with provided schema.
        
        Args:
            schema_sql: SQL statements to create tables
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.executescript(schema_sql)
            conn.commit()
        logger.info(f"Initialized database for mod {self.mod_name}")
    
    def execute_query(self, query: str, params: tuple = ()) -> List[tuple]:
        """Execute a query and return results.
        
        Args:
            query: SQL query
            params: Query parameters
            
        Returns:
            List of result tuples
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            return cursor.fetchall()
    
    def execute_update(self, query: str, params: tuple = ()) -> int:
        """Execute an update/insert/delete query.
        
        Args:
            query: SQL query
            params: Query parameters
            
        Returns:
            Number of affected rows
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            return cursor.rowcount
    
    def save_json_file(self, filename: str, data: Any):
        """Save data as JSON file in mod directory.
        
        Args:
            filename: Name of the file
            data: Data to save
        """
        file_path = self.data_dir / filename
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
    
    def load_json_file(self, filename: str, default: Any = None) -> Any:
        """Load data from JSON file in mod directory.
        
        Args:
            filename: Name of the file
            default: Default value if file doesn't exist
            
        Returns:
            Loaded data or default
        """
        file_path = self.data_dir / filename
        if file_path.exists():
            with open(file_path, 'r') as f:
                return json.load(f)
        return default
    
    def get_file_path(self, filename: str) -> Path:
        """Get full path to a file in mod directory.
        
        Args:
            filename: Name of the file
            
        Returns:
            Full path to the file
        """
        return self.data_dir / filename