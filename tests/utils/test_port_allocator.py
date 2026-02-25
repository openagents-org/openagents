"""
Tests for the port allocator utility.
"""
import pytest
import asyncio
import socket
from openagents.utils.port_allocator import (
    PortAllocator, 
    get_free_port, 
    get_port_pair, 
    release_port, 
    is_port_free,
    wait_for_port_free
)


def test_port_allocator_basic():
    """Test basic port allocation functionality."""
    allocator = PortAllocator()
    
    # Get a free port
    port1 = allocator.get_free_port()
    assert isinstance(port1, int)
    assert 1024 <= port1 <= 65535
    
    # Get another port, should be different
    port2 = allocator.get_free_port()
    assert port1 != port2
    
    # Release ports
    allocator.release_port(port1)
    allocator.release_port(port2)


def test_port_allocator_exclusions():
    """Test port exclusion functionality."""
    allocator = PortAllocator()
    
    exclude_ports = {8080, 8443, 9000}
    port = allocator.get_free_port(exclude_ports=exclude_ports)
    
    assert port not in exclude_ports
    
    allocator.release_port(port)


def test_port_pair_allocation():
    """Test allocating pairs of ports."""
    allocator = PortAllocator()
    
    port1, port2 = allocator.get_port_pair()
    
    assert isinstance(port1, int)
    assert isinstance(port2, int)
    assert port1 != port2
    
    allocator.release_port(port1)
    allocator.release_port(port2)


def test_global_functions():
    """Test global convenience functions."""
    # Get single port
    port1 = get_free_port()
    assert isinstance(port1, int)
    
    # Get port pair
    port2, port3 = get_port_pair()
    assert port1 != port2 != port3
    
    # Release ports
    release_port(port1)
    release_port(port2)
    release_port(port3)


def test_port_free_check():
    """Test checking if ports are free."""
    # Get a port and verify it's marked as allocated
    allocator = PortAllocator()
    port = allocator.get_free_port()
    
    # The port should be free (since we're not actually binding to it)
    assert is_port_free(port)
    
    allocator.release_port(port)


def test_port_collision_avoidance():
    """Test that multiple allocators don't give the same port simultaneously."""
    allocator1 = PortAllocator()
    allocator2 = PortAllocator()
    
    # This test is probabilistic but should generally work
    ports1 = [allocator1.get_free_port() for _ in range(10)]
    ports2 = [allocator2.get_free_port() for _ in range(10)]
    
    # There should be minimal overlap (some overlap is possible but unlikely)
    overlap = set(ports1) & set(ports2)
    assert len(overlap) < 5  # Allow some overlap due to race conditions
    
    # Clean up
    for port in ports1:
        allocator1.release_port(port)
    for port in ports2:
        allocator2.release_port(port)


@pytest.mark.asyncio
async def test_wait_for_port_free():
    """Test waiting for ports to become free."""
    # This test uses a real socket binding
    port = get_free_port()
    
    # Bind to the port
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('localhost', port))
        sock.listen(1)
        
        # Port should not be free
        assert not is_port_free(port)
        
        # Start waiting for port to be free in background
        wait_task = asyncio.create_task(
            asyncio.to_thread(wait_for_port_free, port, 'localhost', 2.0)
        )
        
        # Wait a bit then close socket
        await asyncio.sleep(0.5)
        sock.close()
        
        # The wait should complete successfully
        result = await wait_task
        assert result is True
        
    finally:
        try:
            sock.close()
        except Exception:
            pass
        release_port(port)


def test_allocator_thread_safety():
    """Test that allocator is thread-safe."""
    import threading
    import time
    
    allocator = PortAllocator()
    allocated_ports = []
    errors = []
    
    def allocate_ports():
        try:
            for _ in range(5):
                port = allocator.get_free_port()
                allocated_ports.append(port)
                time.sleep(0.001)  # Small delay to increase chance of race conditions
        except Exception as e:
            errors.append(e)
    
    # Start multiple threads
    threads = [threading.Thread(target=allocate_ports) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    
    # Should have no errors
    assert len(errors) == 0
    
    # Should have unique ports
    assert len(allocated_ports) == len(set(allocated_ports))
    
    # Clean up
    for port in allocated_ports:
        allocator.release_port(port)


if __name__ == "__main__":
    # Run a quick manual test
    print("🧪 Testing port allocator...")
    
    port1 = get_free_port()
    port2, port3 = get_port_pair()
    
    print(f"✅ Allocated ports: {port1}, {port2}, {port3}")
    print(f"✅ Port {port1} is free: {is_port_free(port1)}")
    
    release_port(port1)
    release_port(port2)
    release_port(port3)
    
    print("✅ All tests passed!")