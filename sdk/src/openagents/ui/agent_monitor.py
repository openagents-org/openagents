#!/usr/bin/env python3
"""
Agent Monitor - Textual-based tabbed interface for monitoring multiple agents

This module provides a beautiful terminal UI for monitoring multiple agent logs
in real-time using tabs, with keyboard navigation and search capabilities.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    TabbedContent, TabPane, Header, Footer, Static, 
    Log, Button, Input, Label, DataTable
)
from textual.reactive import reactive
from textual.message import Message
from textual.binding import Binding

from openagents.utils.bulk_agent_manager import BulkAgentManager, AgentInstance


class AgentLogWidget(Log):
    """Enhanced log widget for displaying agent logs with color coding."""
    
    def __init__(self, agent_id: str, **kwargs):
        super().__init__(**kwargs)
        self.agent_id = agent_id
        self.auto_scroll = True
    
    def write_agent_log(self, message: str, level: str = "INFO"):
        """Write a log message with appropriate color coding."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Color code by log level
        if level == "ERROR":
            styled_message = f"[red]{timestamp}[/red] [bold red]ERROR[/bold red] {message}"
        elif level == "WARNING" or level == "WARN":
            styled_message = f"[yellow]{timestamp}[/yellow] [bold yellow]WARN[/bold yellow] {message}"
        elif level == "DEBUG":
            styled_message = f"[dim]{timestamp} DEBUG {message}[/dim]"
        else:  # INFO or default
            styled_message = f"[dim]{timestamp}[/dim] [green]INFO[/green] {message}"
        
        self.write_line(styled_message)
        
        if self.auto_scroll:
            self.scroll_end()


class StatusWidget(Static):
    """Widget displaying overall agent status summary."""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.agent_count = 0
        self.running_count = 0
        self.error_count = 0
    
    def update_status(self, agent_statuses: Dict[str, Dict]):
        """Update status display with current agent information."""
        self.agent_count = len(agent_statuses)
        self.running_count = sum(1 for s in agent_statuses.values() if s.get('status') == 'running')
        self.error_count = sum(1 for s in agent_statuses.values() if s.get('status') == 'error')
        
        status_text = (
            f"[bold blue]Agents:[/bold blue] {self.agent_count} | "
            f"[bold green]Running:[/bold green] {self.running_count} | "
            f"[bold red]Errors:[/bold red] {self.error_count}"
        )
        
        self.update(status_text)


class AgentMonitorApp(App):
    """Main application for monitoring multiple agents with tabbed interface."""
    
    CSS = """
    Screen {
        layout: vertical;
    }
    
    #main_container {
        height: 100%;
    }
    
    #status_bar {
        height: 1;
        background: $surface;
        color: $text;
        text-align: center;
    }
    
    TabbedContent {
        height: 100%;
    }
    
    TabPane {
        height: 100%;
        padding: 0;
    }
    
    AgentLogWidget {
        height: 100%;
        border: solid $primary;
    }
    
    #overview_table {
        height: 100%;
    }
    
    .status_running {
        background: $success;
        color: $success-foreground;
    }
    
    .status_error {
        background: $error;
        color: $error-foreground;
    }
    
    .status_starting {
        background: $warning;
        color: $warning-foreground;
    }
    
    .status_stopped {
        background: $surface;
        color: $text-muted;
    }
    """
    
    BINDINGS = [
        Binding("q", "quit", "Quit", priority=True),
        Binding("r", "refresh", "Refresh", priority=True),
        Binding("s", "show_overview", "Overview"),
        Binding("ctrl+c", "quit", "Quit", priority=True),
        Binding("f", "toggle_autoscroll", "Toggle Auto-scroll"),
        ("tab", "next_tab", "Next Tab"),
        ("shift+tab", "prev_tab", "Previous Tab"),
    ]
    
    def __init__(self, bulk_manager: BulkAgentManager, **kwargs):
        super().__init__(**kwargs)
        self.bulk_manager = bulk_manager
        self.agent_logs: Dict[str, AgentLogWidget] = {}
        self.status_widget: Optional[StatusWidget] = None
        self.overview_table: Optional[DataTable] = None
        self.refresh_timer = None
        self.auto_refresh_interval = 2.0  # seconds
    
    def compose(self) -> ComposeResult:
        """Create the UI layout."""
        yield Header()
        
        with Container(id="main_container"):
            # Status bar
            self.status_widget = StatusWidget(id="status_bar")
            yield self.status_widget
            
            # Tabbed content for agent logs
            with TabbedContent():
                # Overview tab
                with TabPane("📊 Overview", id="overview"):
                    self.overview_table = DataTable(id="overview_table")
                    self.overview_table.add_columns("Agent ID", "Status", "File", "Type", "PID", "Uptime", "Config")
                    yield self.overview_table
                
                # Individual agent tabs
                for agent_id, agent_instance in self.bulk_manager.agents.items():
                    with TabPane(f"🤖 {agent_id}", id=f"tab_{agent_id}"):
                        log_widget = AgentLogWidget(agent_id, wrap=True, highlight=True, markup=True)
                        self.agent_logs[agent_id] = log_widget
                        yield log_widget
        
        yield Footer()
    
    def on_mount(self) -> None:
        """Called when the app is mounted."""
        self.title = "OpenAgents Monitor"
        self.sub_title = f"Monitoring {len(self.bulk_manager.agents)} agents"
        
        # Start auto-refresh timer
        self.refresh_timer = self.set_interval(self.auto_refresh_interval, self.refresh_display)
        
        # Initial refresh
        self.refresh_display()
    
    def on_unmount(self) -> None:
        """Called when the app is unmounted."""
        if self.refresh_timer:
            self.refresh_timer.stop()
    
    def refresh_display(self) -> None:
        """Refresh all display components with latest data."""
        try:
            # Update status bar
            if self.status_widget:
                agent_statuses = self.bulk_manager.get_all_status()
                self.status_widget.update_status(agent_statuses)
            
            # Update overview table
            self.refresh_overview_table()
            
            # Update agent logs (this would need integration with actual log capture)
            # For now, we'll just show status updates
            for agent_id in self.bulk_manager.agents.keys():
                self.update_agent_logs(agent_id)
                
        except Exception as e:
            # Log errors but don't crash the UI
            if "overview" in self.agent_logs:
                self.agent_logs["overview"].write_agent_log(f"Monitor error: {e}", "ERROR")
    
    def refresh_overview_table(self) -> None:
        """Refresh the overview table with current agent statuses."""
        if not self.overview_table:
            return
        
        # Clear existing rows
        self.overview_table.clear()
        
        # Add current agent data
        agent_statuses = self.bulk_manager.get_all_status()
        for agent_id, status in agent_statuses.items():
            if not status:
                continue
            
            # Format uptime
            uptime_str = "—"
            if status.get('uptime'):
                uptime = status['uptime']
                if uptime > 3600:
                    uptime_str = f"{uptime//3600:.0f}h {(uptime%3600)//60:.0f}m"
                elif uptime > 60:
                    uptime_str = f"{uptime//60:.0f}m {uptime%60:.0f}s"
                else:
                    uptime_str = f"{uptime:.0f}s"
            
            # Style status
            status_text = status.get('status', 'unknown')
            if status_text == 'running':
                status_display = f"[green]●[/green] {status_text}"
            elif status_text == 'error':
                status_display = f"[red]●[/red] {status_text}"
            elif status_text == 'starting':
                status_display = f"[yellow]●[/yellow] {status_text}"
            else:
                status_display = f"[dim]●[/dim] {status_text}"
            
            # File type with icon
            file_type = status.get('file_type', 'yaml')
            file_icon = "🐍" if file_type == "python" else "📄"
            file_display = f"{file_icon} {file_type}"
            
            # PID display
            pid = status.get('pid')
            pid_display = str(pid) if pid else "—"
            
            # Add row
            self.overview_table.add_row(
                agent_id,
                status_display,
                file_display,
                status.get('agent_type', 'unknown'),
                pid_display,
                uptime_str,
                status.get('config_path', '').split('/')[-1]  # Just filename
            )
    
    def update_agent_logs(self, agent_id: str) -> None:
        """Update logs for a specific agent."""
        if agent_id not in self.agent_logs:
            return
        
        log_widget = self.agent_logs[agent_id]
        status = self.bulk_manager.get_agent_status(agent_id)
        
        if not status:
            return
        
        # Add status updates as log entries (in a real implementation, 
        # this would be actual log streaming from the agent)
        current_status = status.get('status', 'unknown')
        
        # Only log status changes to avoid spam
        if not hasattr(log_widget, '_last_status'):
            log_widget._last_status = None
        
        if current_status != log_widget._last_status:
            log_widget._last_status = current_status
            
            if current_status == 'starting':
                log_widget.write_agent_log("Agent startup initiated", "INFO")
            elif current_status == 'running':
                log_widget.write_agent_log("Agent is now running", "INFO")
            elif current_status == 'error':
                error_msg = status.get('error_message', 'Unknown error')
                log_widget.write_agent_log(f"Agent error: {error_msg}", "ERROR")
            elif current_status == 'stopped':
                log_widget.write_agent_log("Agent stopped", "INFO")
    
    def action_quit(self) -> None:
        """Quit the application."""
        self.exit()
    
    def action_refresh(self) -> None:
        """Manually refresh the display."""
        self.refresh_display()
    
    def action_show_overview(self) -> None:
        """Switch to the overview tab."""
        tabbed_content = self.query_one(TabbedContent)
        tabbed_content.active = "overview"
    
    def action_toggle_autoscroll(self) -> None:
        """Toggle auto-scroll for all log widgets."""
        for log_widget in self.agent_logs.values():
            log_widget.auto_scroll = not log_widget.auto_scroll
        
        # Show notification
        auto_scroll_status = "enabled" if list(self.agent_logs.values())[0].auto_scroll else "disabled"
        self.notify(f"Auto-scroll {auto_scroll_status}")
    
    def action_next_tab(self) -> None:
        """Switch to the next tab."""
        tabbed_content = self.query_one(TabbedContent)
        tabbed_content.action_next_tab()
    
    def action_prev_tab(self) -> None:
        """Switch to the previous tab."""
        tabbed_content = self.query_one(TabbedContent)
        tabbed_content.action_previous_tab()


def run_agent_monitor(bulk_manager: BulkAgentManager) -> None:
    """Run the agent monitor application.
    
    Args:
        bulk_manager: BulkAgentManager instance to monitor
    """
    app = AgentMonitorApp(bulk_manager)
    app.run()


# For standalone testing
if __name__ == "__main__":
    from openagents.utils.bulk_agent_manager import BulkAgentManager
    
    # Create a test manager (normally this would be populated with real agents)
    manager = BulkAgentManager()
    
    # Run the monitor
    run_agent_monitor(manager)