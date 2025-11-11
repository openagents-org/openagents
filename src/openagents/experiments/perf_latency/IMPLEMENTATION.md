# Implementation Summary

## 📂 File Structure

```
src/openagents/experiments/perf_latency/
├── __init__.py                   # Package initialization
├── __main__.py                   # Module entry point
├── run_openagents_latency.py     # Main benchmark script
├── plot_latency.py               # Visualization script
├── quick_test.py                 # Quick validation test
├── README.md                     # User documentation
└── IMPLEMENTATION.md             # This file
```

---

## 🎯 Design Principles

### 1. **Native OpenAgents Framework**

All components use OpenAgents' native APIs:
- `AgentNetwork` for network management
- `AgentClient` for agent instances
- `Event` model for messaging
- `NetworkConfig` for configuration

**No external transport implementations** - everything goes through the framework.

### 2. **Minimal Dependencies**

Core benchmark requires only:
- OpenAgents framework (required)
- matplotlib (optional, for plotting)

No additional agent frameworks, no separate gRPC/HTTP servers.

### 3. **Reproducible Results**

- Configurable agent counts and iterations
- JSON output for reproducibility
- Timestamp-based file naming
- Comprehensive statistics (mean, median, std dev, percentiles)

### 4. **Production-Ready Code**

- Type hints for all functions
- Comprehensive docstrings
- Error handling and cleanup
- Logging for debugging
- Command-line argument parsing

---

## 🏗️ Architecture

### Component Diagram

```
┌────────────────────────────────────────────────┐
│        LatencyBenchmark                        │
│  (Orchestrates the entire benchmark)           │
└────────────────────────────────────────────────┘
              │
              ├─► setup_network()
              │     └─► Creates AgentNetwork
              │         └─► Starts HTTP transport (port 9570)
              │
              ├─► create_sender_agent()
              │     └─► Creates AgentClient (sender)
              │         └─► Connects to network
              │
              ├─► create_receiver_agents(N)
              │     └─► Creates N AgentClients (receivers)
              │         └─► Registers echo handlers
              │
              ├─► measure_latency_for_count(N)
              │     └─► Runs ping-echo iterations
              │         ├─► send_event("benchmark.ping")
              │         ├─► wait_event("benchmark.pong")
              │         └─► Calculates RTT
              │
              ├─► save_results()
              │     └─► Writes JSON to disk
              │
              └─► cleanup()
                    └─► Disconnects agents & shuts down network
```

### Message Flow

```
Time ──►

Sender                 Receiver_0              Receiver_1
  │                         │                       │
  ├──ping (event)──────────►│                       │
  │   event_name: "benchmark.ping"                  │
  │   payload: {time, iteration}                    │
  │                         │                       │
  │                    [Echo handler]               │
  │                         │                       │
  │◄──pong (event)──────────┤                       │
  │   event_name: "benchmark.pong"                  │
  │   payload: {echo_time, original_time, ...}      │
  │                         │                       │
  │ [Calculate RTT]         │                       │
  │                         │                       │
  ├──ping (event)──────────────────────────────────►│
  │◄──pong (event)──────────────────────────────────┤
  │                         │                       │
  └─────────────────────────┴───────────────────────┘
```

---

## 🔬 Implementation Details

### 1. Network Setup

```python
config = NetworkConfig(
    name="latency-benchmark-network",
    node_id="benchmark-network",
    mode=NetworkMode.CENTRALIZED,
    transports=[
        TransportConfigItem(
            type="http",
            host="127.0.0.1",
            port=9570,
            enabled=True
        )
    ],
)

network = AgentNetwork(config, workspace_path=None)
await network.initialize()
await network.start()
```

**Key Decisions**:
- Uses **centralized topology** for consistency
- **HTTP transport** (standard, well-tested)
- Port **9570** to avoid conflicts with default 8700
- **No persistent workspace** (temporary for benchmark)

### 2. Agent Creation

```python
client = AgentClient(
    agent_id="receiver_0",
    secret="receiver-0-secret",
)

await client.connect(
    network_host="127.0.0.1",
    network_port=9570,
)
```

**Key Decisions**:
- Simple agent IDs (`sender`, `receiver_0`, `receiver_1`, ...)
- Unique secrets for each agent
- All agents connect to same network

### 3. Echo Handler

```python
async def echo_handler(event: Event):
    if event.event_name == "benchmark.ping":
        pong_event = Event(
            event_name="benchmark.pong",
            source_id=client.agent_id,
            destination_id=event.source_id,
            payload={
                "echo_time": time.time(),
                "original_time": event.payload.get("time"),
                "iteration": event.payload.get("iteration"),
            },
        )
        await client.send_event(pong_event)

client.connector.register_message_handler("direct_message", echo_handler)
```

**Key Decisions**:
- Async handler for non-blocking echo
- Preserves iteration number for response matching
- Adds `echo_time` for potential one-way latency calculation

### 4. Latency Measurement

```python
send_time = time.time()
await sender_client.send_event(ping_event)

pong_event = await sender_client.wait_event(
    condition=lambda e: (
        e.event_name == "benchmark.pong" and
        e.payload.get("iteration") == iteration
    ),
    timeout=5.0
)

receive_time = time.time()
rtt = (receive_time - send_time) * 1000  # Convert to ms
```

**Key Decisions**:
- High-resolution timestamps (`time.time()`)
- Condition-based wait to match responses
- 5-second timeout to catch failures
- RTT in milliseconds for readability

### 5. Statistics Calculation

```python
stats = {
    "avg_latency_ms": statistics.mean(latencies),
    "median_latency_ms": statistics.median(latencies),
    "stdev_latency_ms": statistics.stdev(latencies),
    "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)],
    "p99_latency_ms": sorted(latencies)[int(len(latencies) * 0.99)],
}
```

**Key Decisions**:
- Standard Python `statistics` module
- P95/P99 via sorted list indexing
- Captures both central tendency and tail latencies

---

## 📊 Plotting Implementation

### matplotlib Configuration

```python
import matplotlib.pyplot as plt
matplotlib.use('Agg')  # Non-interactive backend
plt.style.use('seaborn-v0_8-darkgrid')
```

**Key Decisions**:
- **Non-interactive backend** for headless environments
- **Seaborn style** for professional appearance
- **High DPI (300)** for publication quality

### Plot Types

1. **Average Latency Line Plot**
   - Shows overall trend
   - Annotated with values

2. **Median + Error Bars (Std Dev)**
   - Shows central tendency with variability
   - Error bars indicate consistency

3. **Percentile Comparison (P50/P95/P99)**
   - Shows tail latency behavior
   - Critical for understanding worst-case performance

4. **Min/Max Range with Median**
   - Shows full distribution
   - Filled area indicates variability

### Output Formats

- **PNG (300 DPI)**: For reports and presentations
- **PDF (vector)**: For publication-quality documents

---

## 🧪 Testing Strategy

### Quick Test (`quick_test.py`)

```bash
python -m openagents.experiments.perf_latency.quick_test
```

- Tests with minimal load (1-2 agents, 10 iterations)
- Validates network setup, agent connections, message flow
- Fast feedback (~10 seconds)

### Full Benchmark

```bash
python -m openagents.experiments.perf_latency.run_openagents_latency
```

- Default: 1, 2, 5, 10, 20, 50 agents
- 50 iterations per count
- Takes ~5-10 minutes

### Custom Benchmark

```bash
python -m openagents.experiments.perf_latency.run_openagents_latency \
    --agents 1,10,50,100 \
    --iterations 100
```

---

## 🚧 Known Limitations

1. **Single Sender**: Only one agent sends pings
   - **Future**: Add concurrent senders for throughput testing

2. **HTTP Only**: Only tests HTTP transport
   - **Future**: Add gRPC comparison

3. **Localhost Only**: No network latency simulation
   - **Future**: Add configurable network delays

4. **No Load Testing**: Agents idle except during pings
   - **Future**: Add background load

5. **Centralized Only**: Doesn't test decentralized topology
   - **Future**: Add topology comparison

---

## 🔄 Cleanup Strategy

```python
async def cleanup(self):
    # 1. Disconnect sender
    await self.sender_client.disconnect()
    
    # 2. Disconnect all receivers
    for client in self.receiver_clients:
        await client.disconnect()
    
    # 3. Shutdown network
    await self.network.shutdown()
```

**Key Decisions**:
- Try-except blocks prevent cleanup failures
- Proper ordering (agents before network)
- Async/await for graceful shutdown

---

## 📈 Performance Characteristics

### Expected Results (Reference Hardware)

| Agents | Avg Latency | Notes |
|--------|-------------|-------|
| 1      | 5-10ms      | Baseline overhead |
| 10     | 8-15ms      | Minimal degradation |
| 50     | 15-30ms     | Linear scaling |
| 100    | 30-60ms     | May show bottlenecks |

**Factors Affecting Performance**:
- CPU speed (serialization/deserialization)
- Memory bandwidth (event copying)
- OS scheduler (context switching)
- Python GIL (multi-threading limitations)

---

## 🛠️ Troubleshooting Guide

### Issue: Port Already in Use

**Symptom**: `OSError: Address already in use`

**Solution**: 
```python
# Change port in run_openagents_latency.py
port=9571,  # or any free port
```

### Issue: Agents Timeout

**Symptom**: `WARNING: Timeout waiting for pong`

**Possible Causes**:
1. Network not fully started
2. Echo handler not registered
3. Event not routed correctly

**Debug Steps**:
1. Enable DEBUG logging: `logging.basicConfig(level=logging.DEBUG)`
2. Check agent registration: `network.topology.get_agent_registry()`
3. Verify event routing in logs

### Issue: Inconsistent Results

**Symptom**: Large standard deviation, erratic results

**Solutions**:
1. Close background applications
2. Increase iterations (`--iterations 200`)
3. Run multiple times and average
4. Check system load (`top`/`htop`)

---

## 🎓 Learning Resources

### For Understanding the Code

1. **OpenAgents Docs**: [https://docs.openagents.com](https://docs.openagents.com)
2. **Event System**: See `src/openagents/models/event.py`
3. **Network Architecture**: See `src/openagents/core/network.py`
4. **Agent Client**: See `src/openagents/core/client.py`

### For Benchmarking Methodology

1. **SLA Best Practices**: Google SRE Book - Measuring SLIs/SLOs
2. **Percentile Statistics**: "Percentiles in Practice" (Gil Tene)
3. **Latency Measurement**: "How NOT to Measure Latency" (Gil Tene)

---

## 🤝 Contributing

### Adding New Metrics

To add a new metric (e.g., throughput):

1. Add field to `stats` dict in `measure_latency_for_count()`
2. Update `print_summary()` to display the metric
3. Update `plot_latency_trends()` to visualize it
4. Document in README.md

### Adding New Test Scenarios

To add a new test (e.g., concurrent senders):

1. Create new class (e.g., `ThroughputBenchmark`)
2. Follow same structure as `LatencyBenchmark`
3. Add new script (e.g., `run_throughput.py`)
4. Add documentation

---

## 📝 Code Quality

### Style

- **PEP 8** compliant
- **Type hints** on all functions
- **Docstrings** (Google style)

### Testing

- Quick test validates core functionality
- No unit tests yet (future enhancement)

### Logging

- Uses Python `logging` module
- WARNING level by default (less noise)
- DEBUG level available for troubleshooting

---

## 🎯 Related Work

- **Issue #84**: Original feature request
- **examples/**: Other OpenAgents examples
- **tests/**: Framework test suite

---

**Questions?** Open an issue on GitHub!

