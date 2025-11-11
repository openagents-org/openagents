# OpenAgents Agent-to-Agent Latency Benchmark

> **Experiment Goal:** Measure message passing latency in OpenAgents networks as agent count scales up.

This experiment addresses [Issue #84](https://github.com/openagents-org/openagents/issues/84) by measuring the round-trip time (RTT) for agent-to-agent messages as the number of agents in the network increases.

---

## 📋 Overview

This benchmark creates a test OpenAgents network and measures ping-echo latency between agents. It helps understand:

- **Scalability**: How does message latency change as more agents join the network?
- **Performance**: What are the baseline latency characteristics of the framework?
- **Bottlenecks**: Where does the framework start to slow down?

### Test Methodology

1. **Network Setup**: Creates a centralized network with HTTP transport
2. **Agent Creation**: Spawns 1 sender agent + N receiver agents
3. **Ping-Echo Test**: Sender sends "ping" messages, receivers echo back "pong"
4. **Measurement**: Records round-trip time (RTT) in milliseconds
5. **Statistics**: Calculates mean, median, std dev, P95, P99 for each agent count

### Key Metrics

- **Average Latency**: Mean round-trip time across all iterations
- **Median Latency**: 50th percentile (P50) - robust to outliers
- **Standard Deviation**: Variability in latency measurements
- **P95/P99 Latency**: 95th and 99th percentile - tail latency
- **Min/Max Latency**: Range of observed latencies

---

## 🚀 Quick Start

### Prerequisites

```bash
# Ensure OpenAgents is installed
pip install -e .

# For plotting (optional)
pip install matplotlib
```

### Run the Benchmark

```bash
# Run with default settings (test 1, 2, 5, 10, 20, 50 agents with 50 iterations each)
python -m openagents.experiments.perf_latency.run_openagents_latency

# Custom agent counts
python -m openagents.experiments.perf_latency.run_openagents_latency --agents 1,5,10,25,50,100

# More iterations for better accuracy
python -m openagents.experiments.perf_latency.run_openagents_latency --iterations 100

# Save results to a specific directory
python -m openagents.experiments.perf_latency.run_openagents_latency --output-dir ./benchmark_results
```

### Generate Plots

```bash
# Plot the most recent results
python -m openagents.experiments.perf_latency.plot_latency

# Plot a specific results file
python -m openagents.experiments.perf_latency.plot_latency latency_results_20240101_120000.json

# Save plots to a specific directory
python -m openagents.experiments.perf_latency.plot_latency --output-dir ./plots
```

---

## 📊 Understanding Results

### Example Output

```
==============================================================
Testing with 10 agent(s)
==============================================================
  Progress: 10/50 iterations
  Progress: 20/50 iterations
  Progress: 30/50 iterations
  Progress: 40/50 iterations
  Progress: 50/50 iterations

📊 Results for 10 agent(s):
  ✅ Successful: 50/50
  📈 Average latency: 12.45 ms
  📊 Median latency: 11.80 ms
  📏 Std deviation: 2.34 ms
  ⬇️  Min latency: 8.12 ms
  ⬆️  Max latency: 18.92 ms
  📐 P95 latency: 16.23 ms
  📐 P99 latency: 17.91 ms
```

### Interpreting the Plot

The generated plot contains 4 subplots:

1. **Average Latency**: Shows how mean RTT increases with agent count
2. **Median Latency with Std Dev**: Shows central tendency with error bars
3. **Percentile Comparison**: Compares P50, P95, P99 to see tail latencies
4. **Min/Max Range**: Shows the full range of observed latencies

#### Expected Patterns

- **Sub-linear scaling**: Latency grows slower than agent count → Excellent scalability
- **Linear scaling**: Latency grows proportionally to agent count → Expected behavior
- **Super-linear scaling**: Latency grows faster than agent count → May indicate bottlenecks

---

## 🧪 Experiment Design

### Architecture

```
┌─────────────────────────────────────────────────┐
│         AgentNetwork (Centralized)              │
│              HTTP Transport                     │
│              Port: 9570                         │
└─────────────────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼───┐   ┌───▼────┐   ┌──▼─────┐
    │ Sender │   │Receiver│   │Receiver│  ... N receivers
    │ Agent  │   │   0    │   │   1    │
    └────┬───┘   └───▲────┘   └──▲─────┘
         │           │           │
         └───ping───►│           │
         ◄───pong────┘           │
         └───────ping───────────►│
         ◄────────pong───────────┘
```

### Message Flow

1. **Sender** creates ping event: `benchmark.ping`
2. **Receiver** receives ping via framework routing
3. **Receiver** immediately sends back pong: `benchmark.pong`
4. **Sender** receives pong and calculates RTT
5. Repeat for N iterations

### Implementation Details

- Uses native OpenAgents `AgentClient` and `AgentNetwork`
- Employs event-based messaging (`Event` model)
- Receivers use async event handlers for immediate echo
- Sender uses `wait_event()` with timeout for synchronous waiting
- Small delays between iterations prevent network overload

---

## 📈 Benchmarking Best Practices

### For Accurate Results

1. **Close Background Apps**: Reduce noise from other processes
2. **Run Multiple Times**: Average across several runs
3. **Increase Iterations**: More iterations = better statistics (e.g., `--iterations 200`)
4. **Test on Target Hardware**: Results vary by CPU, network, OS

### Interpreting Performance

| Avg Latency | Assessment |
|-------------|------------|
| < 5ms       | Excellent - In-process level performance |
| 5-20ms      | Good - Typical for local network |
| 20-50ms     | Acceptable - May include serialization overhead |
| > 50ms      | Needs investigation - Possible bottleneck |

**Note**: These are rough guidelines. Actual acceptable latency depends on your use case.

---

## 🔧 Troubleshooting

### Port Already in Use

```
Error: Address already in use (port 9570)
```

**Solution**: Change the test port in `run_openagents_latency.py`:

```python
# In setup_network() method, change port:
port=9571,  # Use different port
```

### Agents Fail to Connect

```
RuntimeError: Failed to connect sender agent
```

**Solution**: Ensure network is fully started before connecting agents. Increase initial sleep time if needed.

### Timeout Waiting for Pong

```
WARNING: Timeout waiting for pong (iteration X)
```

**Possible Causes**:
- Network congestion (reduce iterations or agent count)
- Echo handler not registered properly
- Network shutdown during test

**Solution**: Check logs for errors, reduce load, or restart the benchmark.

### Import Error: matplotlib

```
ModuleNotFoundError: No module named 'matplotlib'
```

**Solution**: Install matplotlib:

```bash
pip install matplotlib
```

---

## 📁 Output Files

### Results JSON

```json
{
  "metadata": {
    "timestamp": "2024-01-15T10:30:00",
    "iterations_per_count": 50,
    "agent_counts": [1, 2, 5, 10, 20, 50]
  },
  "measurements": [
    {
      "agent_count": 10,
      "successful_iterations": 50,
      "failed_iterations": 0,
      "avg_latency_ms": 12.45,
      "median_latency_ms": 11.80,
      "stdev_latency_ms": 2.34,
      "min_latency_ms": 8.12,
      "max_latency_ms": 18.92,
      "p95_latency_ms": 16.23,
      "p99_latency_ms": 17.91
    }
  ]
}
```

### Generated Plots

- **PNG Format** (300 DPI): For presentations and reports
- **PDF Format**: Publication-quality vector graphics

---

## 🎯 Future Enhancements

Potential extensions to this experiment:

- [ ] Test with different transport types (gRPC vs HTTP)
- [ ] Measure throughput (messages per second)
- [ ] Test with different network topologies (centralized vs decentralized)
- [ ] Add concurrent load (multiple senders)
- [ ] Measure memory usage vs agent count
- [ ] Test with realistic message payloads (small, medium, large)
- [ ] Compare against other agent frameworks

---

## 📚 Related

- **Issue**: [#84 - Measure agent-to-agent latency](https://github.com/openagents-org/openagents/issues/84)
- **Docs**: [OpenAgents Architecture](https://docs.openagents.com/architecture)
- **Examples**: See `examples/` directory for more agent examples

---

## 📝 Notes

- This benchmark uses a **centralized network** for consistency
- HTTP transport is used (gRPC may have different characteristics)
- Receivers use round-robin selection to distribute load
- All measurements are in-memory (no disk I/O)
- Network runs on `localhost` to eliminate network latency

---

## 🤝 Contributing

Found a bug or have an idea for improvement? Please open an issue or PR!

- Report issues: [GitHub Issues](https://github.com/openagents-org/openagents/issues)
- Contribute: [Contributing Guide](https://github.com/openagents-org/openagents/blob/main/CONTRIBUTING.md)

---

**Happy Benchmarking! 🚀**

