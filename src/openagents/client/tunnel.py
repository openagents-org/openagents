"""
Tunnel — expose a local port as a public URL via cloudflared.

Uses Cloudflare's free Quick Tunnel (no account needed):
    cloudflared tunnel --url http://localhost:PORT

The public URL is temporary and lives as long as the process runs.
"""

import asyncio
import logging
import re
import shutil
from typing import Optional

logger = logging.getLogger(__name__)

_URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


class Tunnel:
    """Manages a cloudflared quick tunnel subprocess."""

    def __init__(self, port: int, host: str = "localhost"):
        self.port = port
        self.host = host
        self.url: Optional[str] = None
        self._process: Optional[asyncio.subprocess.Process] = None

    async def start(self, timeout: float = 20) -> str:
        """Start cloudflared and return the public URL.

        Raises RuntimeError if cloudflared is not installed.
        Raises TimeoutError if the URL is not produced in time.
        """
        if not is_available():
            raise RuntimeError(
                "cloudflared is not installed. Install it:\n"
                "  macOS:  brew install cloudflared\n"
                "  Linux:  curl -fsSL https://github.com/cloudflare/cloudflared/"
                "releases/latest/download/cloudflared-linux-amd64 "
                "-o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"
            )

        self._process = await asyncio.create_subprocess_exec(
            "cloudflared", "tunnel", "--url", f"http://{self.host}:{self.port}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        url = await self._wait_for_url(timeout)
        self.url = url
        logger.info("Tunnel open: localhost:%d → %s", self.port, url)
        return url

    async def _wait_for_url(self, timeout: float) -> str:
        """Read stderr until the trycloudflare.com URL appears."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                line = await asyncio.wait_for(
                    self._process.stderr.readline(), timeout=remaining
                )
            except asyncio.TimeoutError:
                break
            if not line:
                break
            text = line.decode(errors="replace")
            match = _URL_PATTERN.search(text)
            if match:
                return match.group(0)

        # Process may have died
        if self._process.returncode is not None:
            stderr = ""
            try:
                stderr = (await self._process.stderr.read()).decode(errors="replace")
            except Exception:
                pass
            raise RuntimeError(f"cloudflared exited with code {self._process.returncode}: {stderr[:200]}")

        raise TimeoutError("cloudflared did not produce a URL within timeout")

    async def stop(self):
        """Terminate the tunnel."""
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            logger.info("Tunnel closed: localhost:%d", self.port)
        self._process = None
        self.url = None

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None


def is_available() -> bool:
    """Check if cloudflared is installed on the system."""
    return shutil.which("cloudflared") is not None
