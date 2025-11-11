#!/bin/bash
# Example Usage Script for OpenAgents Latency Benchmark
# 
# This script demonstrates how to run the benchmark and generate plots.
# Make this script executable: chmod +x example_usage.sh

set -e  # Exit on error

echo "=================================================="
echo "OpenAgents Latency Benchmark - Example Usage"
echo "=================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    echo "❌ Error: Please run this script from the openagents root directory"
    exit 1
fi

# Step 1: Quick test
echo "Step 1: Running quick test (1-2 agents, 10 iterations)..."
echo "This should take about 10-20 seconds"
echo ""
python -m openagents.experiments.perf_latency.quick_test
echo ""
echo "✅ Quick test completed!"
echo ""

# Wait for user
read -p "Press Enter to continue with full benchmark..."
echo ""

# Step 2: Full benchmark (commented out by default - uncomment to run)
echo "Step 2: Running full benchmark (1,2,5,10,20,50 agents, 50 iterations each)..."
echo "This will take 5-10 minutes"
echo ""
# Uncomment the line below to run the full benchmark
# python -m openagents.experiments.perf_latency.run_openagents_latency
echo "⚠️  Full benchmark is commented out to save time."
echo "   Uncomment the line in this script to run it."
echo ""

# Step 3: Plot results
echo "Step 3: Generating plots from quick test results..."
echo ""
python -m openagents.experiments.perf_latency.plot_latency
echo ""
echo "✅ Plots generated!"
echo ""

# Summary
echo "=================================================="
echo "Summary"
echo "=================================================="
echo ""
echo "✅ Quick test completed"
echo "📊 Results saved in test_results/"
echo "📈 Plots generated (PNG + PDF)"
echo ""
echo "Next steps:"
echo "  1. View the plots in test_results/"
echo "  2. Review latency_results_*.json"
echo "  3. Run full benchmark by uncommenting line in this script"
echo "  4. Read README.md for more options"
echo ""
echo "=================================================="

