#!/usr/bin/env python3
"""
Plot Latency Results

This script reads the latency measurement results from JSON files
and generates visualizations showing how latency scales with agent count.

Usage:
    python -m openagents.experiments.perf_latency.plot_latency <results_file.json>
    
    # Or plot the most recent results file:
    python -m openagents.experiments.perf_latency.plot_latency
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend


def load_results(filepath: Path) -> Dict:
    """
    Load benchmark results from JSON file.
    
    Args:
        filepath: Path to the results JSON file
        
    Returns:
        Dict containing the benchmark results
        
    Raises:
        FileNotFoundError: If the file doesn't exist
        json.JSONDecodeError: If the file is not valid JSON
    """
    if not filepath.exists():
        raise FileNotFoundError(f"Results file not found: {filepath}")
    
    with open(filepath, 'r') as f:
        return json.load(f)


def find_latest_results(directory: Path = Path.cwd()) -> Optional[Path]:
    """
    Find the most recent results file in the given directory.
    
    Args:
        directory: Directory to search for results files
        
    Returns:
        Path to the most recent results file, or None if not found
    """
    results_files = list(directory.glob("latency_results_*.json"))
    
    if not results_files:
        return None
    
    # Sort by modification time (most recent first)
    results_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return results_files[0]


def plot_latency_trends(results: Dict, output_dir: Path) -> None:
    """
    Generate latency trend plots from benchmark results.
    
    Creates multiple visualizations:
    1. Average latency vs agent count
    2. Median latency vs agent count with error bars (std dev)
    3. Percentile comparison (P50, P95, P99)
    
    Args:
        results: Benchmark results dictionary
        output_dir: Directory to save the plots
    """
    measurements = results["measurements"]
    metadata = results["metadata"]
    
    # Extract data
    agent_counts = [m["agent_count"] for m in measurements]
    avg_latencies = [m["avg_latency_ms"] for m in measurements]
    median_latencies = [m["median_latency_ms"] for m in measurements]
    stdev_latencies = [m["stdev_latency_ms"] for m in measurements]
    p95_latencies = [m["p95_latency_ms"] for m in measurements]
    p99_latencies = [m["p99_latency_ms"] for m in measurements]
    min_latencies = [m["min_latency_ms"] for m in measurements]
    max_latencies = [m["max_latency_ms"] for m in measurements]
    
    # Set up the plot style
    plt.style.use('seaborn-v0_8-darkgrid' if 'seaborn-v0_8-darkgrid' in plt.style.available else 'default')
    
    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(
        f"OpenAgents Agent-to-Agent Latency Benchmark\n"
        f"({metadata['iterations_per_count']} iterations per agent count)",
        fontsize=14,
        fontweight='bold'
    )
    
    # Plot 1: Average Latency
    ax1 = axes[0, 0]
    ax1.plot(agent_counts, avg_latencies, marker='o', linewidth=2, markersize=8, color='#2E86AB')
    ax1.set_xlabel('Number of Agents', fontsize=11)
    ax1.set_ylabel('Average Latency (ms)', fontsize=11)
    ax1.set_title('Average Round-Trip Latency', fontsize=12, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(agent_counts)
    
    # Add value labels
    for x, y in zip(agent_counts, avg_latencies):
        ax1.annotate(f'{y:.1f}ms', (x, y), textcoords="offset points", 
                    xytext=(0, 10), ha='center', fontsize=9)
    
    # Plot 2: Median Latency with Error Bars (Std Dev)
    ax2 = axes[0, 1]
    ax2.errorbar(agent_counts, median_latencies, yerr=stdev_latencies, 
                marker='s', linewidth=2, markersize=8, capsize=5, color='#A23B72')
    ax2.set_xlabel('Number of Agents', fontsize=11)
    ax2.set_ylabel('Median Latency (ms)', fontsize=11)
    ax2.set_title('Median Latency with Standard Deviation', fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(agent_counts)
    
    # Plot 3: Percentile Comparison
    ax3 = axes[1, 0]
    ax3.plot(agent_counts, median_latencies, marker='o', label='P50 (Median)', 
            linewidth=2, markersize=7, color='#F18F01')
    ax3.plot(agent_counts, p95_latencies, marker='^', label='P95', 
            linewidth=2, markersize=7, color='#C73E1D')
    ax3.plot(agent_counts, p99_latencies, marker='D', label='P99', 
            linewidth=2, markersize=7, color='#6A040F')
    ax3.set_xlabel('Number of Agents', fontsize=11)
    ax3.set_ylabel('Latency (ms)', fontsize=11)
    ax3.set_title('Latency Percentiles', fontsize=12, fontweight='bold')
    ax3.legend(loc='upper left', fontsize=10)
    ax3.grid(True, alpha=0.3)
    ax3.set_xticks(agent_counts)
    
    # Plot 4: Min/Max Range
    ax4 = axes[1, 1]
    ax4.fill_between(agent_counts, min_latencies, max_latencies, alpha=0.3, color='#0F4C5C')
    ax4.plot(agent_counts, min_latencies, marker='v', label='Min', 
            linewidth=2, markersize=7, color='#0F4C5C')
    ax4.plot(agent_counts, max_latencies, marker='^', label='Max', 
            linewidth=2, markersize=7, color='#9A031E')
    ax4.plot(agent_counts, median_latencies, marker='o', label='Median', 
            linewidth=2, markersize=7, color='#FB8B24', linestyle='--')
    ax4.set_xlabel('Number of Agents', fontsize=11)
    ax4.set_ylabel('Latency (ms)', fontsize=11)
    ax4.set_title('Latency Range (Min/Max)', fontsize=12, fontweight='bold')
    ax4.legend(loc='upper left', fontsize=10)
    ax4.grid(True, alpha=0.3)
    ax4.set_xticks(agent_counts)
    
    # Adjust layout to prevent overlap
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    
    # Save the plot
    output_file = output_dir / f"latency_plot_{metadata['timestamp'].replace(':', '-').replace('.', '_')}.png"
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"📊 Plot saved to: {output_file}")
    
    # Also save as PDF for publication quality
    output_pdf = output_file.with_suffix('.pdf')
    plt.savefig(output_pdf, bbox_inches='tight')
    print(f"📄 PDF version saved to: {output_pdf}")
    
    plt.close()


def print_summary_stats(results: Dict) -> None:
    """
    Print a summary of the benchmark results.
    
    Args:
        results: Benchmark results dictionary
    """
    measurements = results["measurements"]
    metadata = results["metadata"]
    
    print("\n" + "=" * 70)
    print("Benchmark Results Summary")
    print("=" * 70)
    print(f"Timestamp: {metadata['timestamp']}")
    print(f"Iterations per agent count: {metadata['iterations_per_count']}")
    print("\n" + "-" * 70)
    print(f"{'Agents':<8} {'Avg (ms)':<10} {'Median (ms)':<12} {'Std Dev':<10} {'P95 (ms)':<10} {'P99 (ms)':<10}")
    print("-" * 70)
    
    for m in measurements:
        print(
            f"{m['agent_count']:<8} "
            f"{m['avg_latency_ms']:<10.2f} "
            f"{m['median_latency_ms']:<12.2f} "
            f"{m['stdev_latency_ms']:<10.2f} "
            f"{m['p95_latency_ms']:<10.2f} "
            f"{m['p99_latency_ms']:<10.2f}"
        )
    
    print("=" * 70)
    
    # Calculate scaling factor
    if len(measurements) >= 2:
        first = measurements[0]
        last = measurements[-1]
        agent_ratio = last['agent_count'] / first['agent_count']
        latency_ratio = last['avg_latency_ms'] / first['avg_latency_ms']
        
        print(f"\n📈 Scaling Analysis:")
        print(f"   Agent count increased by {agent_ratio:.1f}x ({first['agent_count']} → {last['agent_count']})")
        print(f"   Average latency increased by {latency_ratio:.2f}x ({first['avg_latency_ms']:.2f}ms → {last['avg_latency_ms']:.2f}ms)")
        
        if latency_ratio < agent_ratio * 0.5:
            print(f"   ✅ Sub-linear scaling: Framework scales well!")
        elif latency_ratio < agent_ratio * 1.5:
            print(f"   📊 Linear scaling: Expected behavior")
        else:
            print(f"   ⚠️  Super-linear scaling: May need optimization")


def main():
    """Main entry point for the plotting script."""
    parser = argparse.ArgumentParser(
        description="Plot latency benchmark results from OpenAgents experiments"
    )
    parser.add_argument(
        "results_file",
        type=str,
        nargs='?',
        help="Path to the results JSON file (if not provided, uses the most recent file)"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Directory to save plots (default: same as results file)"
    )
    
    args = parser.parse_args()
    
    # Determine results file
    if args.results_file:
        results_path = Path(args.results_file)
    else:
        print("🔍 Looking for the most recent results file...")
        results_path = find_latest_results()
        if not results_path:
            print("❌ No results files found in current directory")
            print("   Please run the benchmark first or specify a results file")
            return 1
        print(f"📂 Found: {results_path}")
    
    # Determine output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = results_path.parent
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # Load results
        print(f"\n📖 Loading results from: {results_path}")
        results = load_results(results_path)
        
        # Print summary
        print_summary_stats(results)
        
        # Generate plots
        print(f"\n🎨 Generating plots...")
        plot_latency_trends(results, output_dir)
        
        print("\n✅ Plotting completed successfully!")
        return 0
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

