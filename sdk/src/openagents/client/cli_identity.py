"""CLI identity commands — certs generate/verify, agentid parse/verify/info/resolve/etc."""

import json
import logging
from pathlib import Path
from typing import List, Optional

import requests
import typer
from rich.panel import Panel
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console

certs_app = typer.Typer(
    name="certs",
    help="\U0001f510 Certificate management commands",
    rich_markup_mode="rich",
)
agentid_app = typer.Typer(
    name="agentid",
    help="\U0001faa2 Agent Identity verification and authentication",
    rich_markup_mode="rich",
)
app.add_typer(certs_app, name="certs", rich_help_panel="Identity")
app.add_typer(agentid_app, name="agentid", rich_help_panel="Identity")

@certs_app.command("generate")
def certs_generate(
    output: str = typer.Option("./certs", "--output", "-o", help="Output directory for certificates"),
    common_name: str = typer.Option("localhost", "--common-name", "-cn", help="Common name for the certificate"),
    days: int = typer.Option(365, "--days", "-d", help="Number of days the certificate is valid"),
    san: Optional[List[str]] = typer.Option(None, "--san", help="Subject Alternative Names (can be used multiple times)"),
):
    """
    Generate self-signed certificates for development.
    
    Creates a CA certificate and server certificate for local development and testing.
    """
    from openagents.utils.cert_generator import CertificateGenerator
    
    try:
        console.print(f"[blue]🔐 Generating certificates in {output}...[/blue]")
        
        paths = CertificateGenerator.generate_self_signed(
            output_dir=output,
            common_name=common_name,
            days_valid=days,
            san_names=list(san) if san else None
        )
        
        console.print()
        console.print("[green]✅ Certificate generation successful![/green]")
        console.print()
        console.print(f"[cyan]📄 CA Certificate:[/cyan] {paths['ca_cert']}")
        console.print(f"[cyan]📄 Server Certificate:[/cyan] {paths['server_cert']}")
        console.print(f"[cyan]🔑 Server Key:[/cyan] {paths['server_key']}")
        console.print()
        
        # Show example configuration
        console.print("[yellow]📋 Example network.yaml configuration:[/yellow]")
        console.print()
        example_config = f"""[dim]transports:
  - type: grpc
    config:
      port: 8600
      tls:
        enabled: true
        cert_file: "{paths['server_cert']}"
        key_file: "{paths['server_key']}"
        ca_file: "{paths['ca_cert']}"[/dim]"""
        console.print(example_config)
        console.print()
        
        console.print("[green]💡 Tip:[/green] Use [cyan]openagents certs verify[/cyan] to check certificate details")
        
    except Exception as e:
        console.print(f"[red]❌ Failed to generate certificates: {e}[/red]")
        raise typer.Exit(1)


@certs_app.command("verify")
def certs_verify(
    cert_file: str = typer.Argument(..., help="Path to certificate file to verify"),
):
    """
    Verify and display information about a certificate file.
    
    Shows certificate details including subject, issuer, validity period, and SAN.
    """
    from openagents.utils.cert_generator import CertificateGenerator
    from datetime import datetime
    
    try:
        cert_path = Path(cert_file)
        if not cert_path.exists():
            console.print(f"[red]❌ Certificate file not found: {cert_file}[/red]")
            raise typer.Exit(1)
        
        console.print(f"[blue]🔍 Verifying certificate: {cert_file}[/blue]")
        console.print()
        
        info = CertificateGenerator.verify_certificate(cert_file)
        
        # Create a rich table for certificate info
        table = Table(title="Certificate Information", show_header=False, box=box.ROUNDED)
        table.add_column("Field", style="cyan", no_wrap=True)
        table.add_column("Value", style="white")
        
        table.add_row("Subject", info["subject"])
        table.add_row("Issuer", info["issuer"])
        table.add_row("Valid From", info["valid_from"])
        table.add_row("Valid Until", info["valid_until"])
        table.add_row("Serial Number", info["serial"])
        if info.get("san"):
            table.add_row("Subject Alt Names", info["san"])
        
        console.print(table)
        console.print()
        
        # Check if certificate is expired
        valid_until = datetime.fromisoformat(info["valid_until"])
        if valid_until < datetime.now():
            console.print("[red]⚠️  Certificate has expired![/red]")
        else:
            days_left = (valid_until - datetime.now()).days
            if days_left < 30:
                console.print(f"[yellow]⚠️  Certificate expires in {days_left} days[/yellow]")
            else:
                console.print(f"[green]✅ Certificate is valid (expires in {days_left} days)[/green]")
        
    except Exception as e:
        console.print(f"[red]❌ Failed to verify certificate: {e}[/red]")
        raise typer.Exit(1)


# Global options callback
def version_callback(value: bool):
    if value:
        version()
        raise typer.Exit()


def verbose_callback(value: bool):
    global VERBOSE_MODE
    VERBOSE_MODE = value
    return value

@agentid_app.command("parse")
def agentid_parse(
    agent_id: str = typer.Argument(..., help="Agent ID to parse (e.g., openagents:my-agent or did:openagents:my-agent@org)")
):
    """🔍 Parse an Agent ID format (no API call)"""
    from openagents.agentid import parse_agent_id, AgentIDFormatError

    try:
        parsed = parse_agent_id(agent_id)

        table = Table(title="📋 Parsed Agent ID", box=box.ROUNDED)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="green")

        table.add_row("Input", agent_id)
        table.add_row("Agent Name", parsed.agent_name)
        table.add_row("Organization", parsed.org or "[dim]None[/dim]")
        table.add_row("Format", parsed.format.value)
        table.add_row("Level 2 ID", parsed.level_2_id)
        table.add_row("Level 3 ID", parsed.level_3_id)

        console.print(table)

    except AgentIDFormatError as e:
        console.print(f"[red]❌ Invalid format: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("verify")
def agentid_verify(
    agent_id: str = typer.Argument(..., help="Agent ID to verify (e.g., openagents:my-agent)")
):
    """✅ Verify an Agent ID exists in the registry"""
    from openagents.agentid import AgentIDVerifier, AgentIDFormatError, AgentIDConnectionError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"🔍 Verifying {agent_id}...", total=None)

            client = AgentIDVerifier()
            result = client.validate(agent_id)

        if result.verified:
            panel_content = f"""[green]✅ Agent Verified[/green]

[bold]Agent Name:[/bold] {result.agent_name}
[bold]Organization:[/bold] {result.org or '[dim]None[/dim]'}
[bold]Status:[/bold] {result.status or 'active'}

[bold]Level 2 ID:[/bold] [cyan]{result.level_2_id}[/cyan]
[bold]Level 3 ID:[/bold] [cyan]{result.level_3_id}[/cyan]"""
            console.print(Panel(panel_content, title="🪪 Agent Identity", border_style="green"))
        else:
            console.print(Panel(
                f"[red]❌ Agent not found[/red]\n\n{result.message}",
                title="🪪 Agent Identity",
                border_style="red"
            ))
            raise typer.Exit(1)

    except AgentIDFormatError as e:
        console.print(f"[red]❌ Invalid format: {e.message}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("info")
def agentid_info(
    agent_name: str = typer.Argument(..., help="Agent name to look up"),
    org: Optional[str] = typer.Option(None, "--org", "-o", help="Legacy organization scope (deprecated)")
):
    """📋 Get detailed agent information"""
    from openagents.agentid import AgentIDVerifier, AgentIDNotFoundError, AgentIDConnectionError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"🔍 Looking up {agent_name}...", total=None)

            client = AgentIDVerifier()
            info = client.get_agent_info(agent_name, org=org)

        table = Table(title="📋 Agent Information", box=box.ROUNDED)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="green")

        table.add_row("Agent Name", info.agent_name)
        table.add_row("Organization", info.org or "[dim]None[/dim]")
        table.add_row("Status", info.status)
        table.add_row("Algorithm", info.algorithm or "[dim]Not specified[/dim]")
        table.add_row("Certificate Serial", info.cert_serial or "[dim]None[/dim]")
        if info.created_at:
            table.add_row("Created At", str(info.created_at))

        console.print(table)

    except AgentIDNotFoundError:
        full_id = f"{agent_name}@{org}" if org else agent_name
        console.print(f"[red]❌ Agent not found: {full_id}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("resolve")
def agentid_resolve(
    did: str = typer.Argument(..., help="DID to resolve (e.g., did:openagents:my-agent)")
):
    """🔗 Resolve a DID document"""
    from openagents.agentid import AgentIDVerifier, AgentIDNotFoundError, AgentIDConnectionError, AgentIDFormatError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"🔍 Resolving {did}...", total=None)

            client = AgentIDVerifier()
            doc = client.resolve_did(did)

        # Display DID Document
        console.print(Panel(
            f"[bold]DID:[/bold] [cyan]{doc.id}[/cyan]",
            title="🔗 DID Document",
            border_style="blue"
        ))

        # Verification Methods
        if doc.verification_method:
            table = Table(title="🔑 Verification Methods", box=box.ROUNDED)
            table.add_column("ID", style="cyan")
            table.add_column("Type", style="green")

            for method in doc.verification_method:
                method_id = method.id.split("#")[-1] if "#" in method.id else method.id
                table.add_row(method_id, method.type)

            console.print(table)

        # Authentication
        if doc.authentication:
            console.print(f"[bold]Authentication:[/bold] {', '.join(doc.authentication)}")

        # Services
        if doc.service:
            table = Table(title="🌐 Services", box=box.ROUNDED)
            table.add_column("Type", style="cyan")
            table.add_column("Endpoint", style="green")

            for svc in doc.service:
                table.add_row(svc.type, svc.service_endpoint)

            console.print(table)

    except AgentIDFormatError as e:
        console.print(f"[red]❌ Invalid format: {e.message}[/red]")
        raise typer.Exit(1)
    except AgentIDNotFoundError:
        console.print(f"[red]❌ DID not found: {did}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("verify-token")
def agentid_verify_token(
    token: str = typer.Argument(..., help="JWT token to verify")
):
    """🔐 Verify a JWT token"""
    from openagents.agentid import AgentIDVerifier, AgentIDConnectionError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task("🔍 Verifying token...", total=None)

            client = AgentIDVerifier()
            result = client.verify_token(token)

        if result.valid:
            table = Table(title="✅ Token Valid", box=box.ROUNDED)
            table.add_column("Field", style="cyan")
            table.add_column("Value", style="green")

            table.add_row("Agent Name", result.agent_name or "[dim]Unknown[/dim]")
            table.add_row("Organization", result.org or "[dim]None[/dim]")
            table.add_row("Verification Level", str(result.verification_level or 2))
            if result.expires_at:
                table.add_row("Expires At", str(result.expires_at))

            console.print(table)
        else:
            console.print(Panel(
                f"[red]❌ Token Invalid[/red]\n\nReason: {result.reason or 'Unknown'}",
                title="🔐 Token Verification",
                border_style="red"
            ))
            raise typer.Exit(1)

    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("challenge")
def agentid_challenge(
    agent_name: str = typer.Argument(..., help="Agent name to request challenge for"),
    org: Optional[str] = typer.Option(None, "--org", "-o", help="Legacy organization scope (deprecated)"),
    algorithm: str = typer.Option("RS256", "--algorithm", "-a", help="Signing algorithm (RS256 or Ed25519)")
):
    """🎯 Request an authentication challenge"""
    from openagents.agentid import AgentIDVerifier, AgentIDNotFoundError, AgentIDConnectionError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"🔍 Requesting challenge for {agent_name}...", total=None)

            client = AgentIDVerifier()
            challenge = client.request_challenge(agent_name, org=org, algorithm=algorithm)

        console.print(Panel(
            f"""[bold]Challenge requested successfully![/bold]

[bold]Nonce:[/bold] [cyan]{challenge.nonce}[/cyan]
[bold]Algorithm:[/bold] {challenge.algorithm}
[bold]Expires In:[/bold] {challenge.expires_in} seconds

[bold]Challenge (Base64):[/bold]
[dim]{challenge.challenge}[/dim]

[yellow]Sign this challenge with your private key and use the 'token' command to get a JWT.[/yellow]""",
            title="🎯 Authentication Challenge",
            border_style="blue"
        ))

    except AgentIDNotFoundError:
        full_id = f"{agent_name}@{org}" if org else agent_name
        console.print(f"[red]❌ Agent not found: {full_id}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("token")
def agentid_token(
    agent_name: str = typer.Argument(..., help="Agent name"),
    nonce: str = typer.Option(..., "--nonce", "-n", help="Challenge nonce"),
    signature: str = typer.Option(..., "--signature", "-s", help="Base64-encoded signature"),
    org: Optional[str] = typer.Option(None, "--org", "-o", help="Legacy organization scope (deprecated)"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Output only the token")
):
    """🎫 Exchange a signature for a JWT token"""
    from openagents.agentid import AgentIDVerifier, AgentIDAuthenticationError, AgentIDConnectionError

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task("🔍 Exchanging signature for token...", total=None)

            client = AgentIDVerifier()
            token = client.get_token(agent_name, nonce, signature, org=org)

        if quiet:
            console.print(token.access_token)
        else:
            console.print(Panel(
                f"""[green]✅ Token obtained successfully![/green]

[bold]Token Type:[/bold] {token.token_type}
[bold]Expires In:[/bold] {token.expires_in} seconds
[bold]Verification Level:[/bold] {token.verification_level}

[bold]Access Token:[/bold]
[dim]{token.access_token[:50]}...{token.access_token[-20:]}[/dim]

Use with: [cyan]Authorization: Bearer <token>[/cyan]""",
                title="🎫 JWT Token",
                border_style="green"
            ))

    except AgentIDAuthenticationError as e:
        console.print(f"[red]❌ Authentication failed: {e.message}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)


@agentid_app.command("auth")
def agentid_auth(
    agent_name: str = typer.Argument(..., help="Agent name"),
    key: str = typer.Option(..., "--key", "-k", help="Path to private key PEM file"),
    org: Optional[str] = typer.Option(None, "--org", "-o", help="Legacy organization scope (deprecated)"),
    algorithm: str = typer.Option("RS256", "--algorithm", "-a", help="Signing algorithm"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Output only the token")
):
    """🔑 Authenticate and get a JWT token (complete flow)"""
    from openagents.agentid import AgentIDAuth, AgentIDAuthenticationError, AgentIDConnectionError, AgentIDNotFoundError
    from pathlib import Path

    key_path = Path(key)
    if not key_path.exists():
        console.print(f"[red]❌ Private key file not found: {key}[/red]")
        raise typer.Exit(1)

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"🔐 Authenticating as {agent_name}...", total=None)

            auth = AgentIDAuth(
                agent_name=agent_name,
                org=org,
                private_key_path=key_path,
                algorithm=algorithm
            )
            token = auth.get_token()

        if quiet:
            console.print(token.access_token)
        else:
            full_id = f"{agent_name}@{org}" if org else agent_name
            console.print(Panel(
                f"""[green]✅ Authentication successful![/green]

[bold]Agent:[/bold] [cyan]{full_id}[/cyan]
[bold]Token Type:[/bold] {token.token_type}
[bold]Expires In:[/bold] {token.expires_in} seconds
[bold]Verification Level:[/bold] {token.verification_level}

[bold]Access Token:[/bold]
[dim]{token.access_token[:50]}...{token.access_token[-20:]}[/dim]

Use with: [cyan]Authorization: Bearer <token>[/cyan]""",
                title="🔑 Authenticated",
                border_style="green"
            ))

    except AgentIDNotFoundError:
        full_id = f"{agent_name}@{org}" if org else agent_name
        console.print(f"[red]❌ Agent not found: {full_id}[/red]")
        raise typer.Exit(1)
    except AgentIDAuthenticationError as e:
        console.print(f"[red]❌ Authentication failed: {e.message}[/red]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        console.print(f"[red]❌ Connection error: {e.message}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        raise typer.Exit(1)


@agentid_app.command("claim")
def agentid_claim(
    agent_name: str = typer.Argument(..., help="Agent name to claim"),
    key: str = typer.Option(..., "--key", "-k", help="Path to public key PEM file"),
    org: Optional[str] = typer.Option(None, "--org", "-o", help="Legacy organization scope (deprecated)"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-a", help="API key for authentication"),
    save_cert: Optional[str] = typer.Option(None, "--save-cert", "-c", help="Path to save the issued certificate"),
):
    """📝 Claim/register a new Agent ID"""
    from openagents.agentid import AgentIDVerifier, AgentIDAuthenticationError, AgentIDConnectionError
    from pathlib import Path
    import os

    key_path = Path(key)
    if not key_path.exists():
        console.print(f"[red]❌ Public key file not found: {key}[/red]")
        raise typer.Exit(1)

    # Read public key
    try:
        with open(key_path, "r") as f:
            public_key_pem = f.read()
    except Exception as e:
        console.print(f"[red]❌ Failed to read public key: {e}[/red]")
        raise typer.Exit(1)

    # Try to get API key from environment if not provided
    if not api_key:
        api_key = os.environ.get("OPENAGENTS_API_KEY")

    if not api_key:
        console.print("[yellow]⚠️  No API key provided. Use --api-key or set OPENAGENTS_API_KEY environment variable.[/yellow]")
        raise typer.Exit(1)

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task(f"📝 Claiming {agent_name}...", total=None)

            client = AgentIDVerifier()
            result = client.claim_agent_id(
                agent_name=agent_name,
                public_key_pem=public_key_pem,
                org=org,
                api_key=api_key,
            )

        # Save certificate if requested
        if save_cert and result.cert_pem:
            cert_path = Path(save_cert)
            cert_path.write_text(result.cert_pem)
            cert_saved_msg = f"\n[bold]Certificate saved to:[/bold] [cyan]{save_cert}[/cyan]"
        else:
            cert_saved_msg = ""

        full_id = f"{result.agent_name}@{result.org}" if result.org else result.agent_name
        console.print(Panel(
            f"""[green]✅ Agent ID claimed successfully![/green]

[bold]Agent Name:[/bold] {result.agent_name}
[bold]Organization:[/bold] {result.org or '[dim]None[/dim]'}
[bold]Status:[/bold] {result.status}
[bold]Certificate Serial:[/bold] {result.serial or '[dim]None[/dim]'}

[bold]Level 2 ID:[/bold] [cyan]openagents:{full_id}[/cyan]
[bold]Level 3 ID:[/bold] [cyan]did:openagents:{full_id}[/cyan]{cert_saved_msg}""",
            title="📝 Agent ID Claimed",
            border_style="green"
        ))

    except AgentIDAuthenticationError as e:
        console.print(f"[red]❌ Authentication failed: {e.message}[/red]")
        console.print("[dim]Make sure your API key is valid.[/dim]")
        raise typer.Exit(1)
    except AgentIDConnectionError as e:
        if "already exists" in str(e.message).lower():
            console.print(f"[red]❌ Agent ID already exists: {agent_name}[/red]")
            console.print("[dim]Choose a different agent name or check if you already own this agent.[/dim]")
        else:
            console.print(f"[red]❌ Error: {e.message}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        raise typer.Exit(1)


# ============================================================================
# DAEMON COMMANDS (openagents up / down / status / add / remove / agents)
# ============================================================================


