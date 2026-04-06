"""
Dynamic port allocation utilities for tests to avoid port conflicts.
"""
import socket
import threading
from typing import Set
import time

class PortAllocator:
    """Thread-safe port allocator that guarantees unique available ports."""
    
    def __init__(self):
        self._allocated_ports: Set[int] = set()
        self._lock = threading.Lock()
    
    def get_free_port(self, exclude_ports: Set[int] = None) -> int:
        """
        Get a free port that's guaranteed to be available and not already allocated.
        
        Args:
            exclude_ports: Set of ports to exclude from allocation
            
        Returns:
            An available port number
        """
        exclude_ports = exclude_ports or set()
        
        with self._lock:
            max_attempts = 100
            for _ in range(max_attempts):
                # Let OS pick a free port
                port = self._find_os_free_port()
                
                # Check if port is already allocated by us or excluded
                if port not in self._allocated_ports and port not in exclude_ports:
                    self._allocated_ports.add(port)
                    return port
            
            raise RuntimeError(f"Could not find free port after {max_attempts} attempts")
    
    def get_port_pair(self) -> tuple[int, int]:
        """
        Get two free ports for services that need multiple ports (e.g., gRPC + HTTP).
        
        Returns:
            Tuple of (port1, port2) where both are guaranteed to be free
        """
        # Don't hold lock while calling get_free_port to avoid deadlock
        port1 = self.get_free_port()
        port2 = self.get_free_port(exclude_ports={port1})
        return port1, port2
    
    def release_port(self, port: int) -> None:
        """Release a previously allocated port."""
        with self._lock:
            self._allocated_ports.discard(port)
    
    def release_all(self) -> None:
        """Release all allocated ports."""
        with self._lock:
            self._allocated_ports.clear()
    
    @staticmethod
    def _find_os_free_port() -> int:
        """Find a free port using OS allocation."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            s.listen(1)
            port = s.getsockname()[1]
        return port
    
    @staticmethod 
    def is_port_free(port: int, host: str = 'localhost') -> bool:
        """Check if a specific port is free."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex((host, port))
                return result != 0  # Port is free if connection failed
        except socket.error:
            return True
    
    @staticmethod
    def wait_for_port_free(port: int, host: str = 'localhost', timeout: float = 10.0) -> bool:
        """
        Wait for a port to become free (useful for cleanup after tests).
        
        Args:
            port: Port to check
            host: Host to check port on
            timeout: Maximum time to wait in seconds
            
        Returns:
            True if port became free, False if timeout
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            if PortAllocator.is_port_free(port, host):
                return True
            time.sleep(0.1)
        return False


# Global instance for test usage
_global_allocator = PortAllocator()

def get_free_port() -> int:
    """Get a free port using the global allocator."""
    return _global_allocator.get_free_port()

def get_port_pair() -> tuple[int, int]:
    """Get a pair of free ports using the global allocator."""
    return _global_allocator.get_port_pair()

def release_port(port: int) -> None:
    """Release a port using the global allocator."""
    _global_allocator.release_port(port)

def release_all_ports() -> None:
    """Release all allocated ports."""
    _global_allocator.release_all()

def is_port_free(port: int, host: str = 'localhost') -> bool:
    """Check if a port is free."""
    return PortAllocator.is_port_free(port, host)

def wait_for_port_free(port: int, host: str = 'localhost', timeout: float = 10.0) -> bool:
    """Wait for a port to become free."""
    return PortAllocator.wait_for_port_free(port, host, timeout)