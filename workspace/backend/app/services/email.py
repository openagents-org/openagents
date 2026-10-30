# -*- coding: utf-8 -*-
"""Transactional email via Resend (https://resend.com/docs/api-reference).

One tiny wrapper instead of an SMTP stack: a single HTTPS POST, keyed by
RESEND_API_KEY. When no key is configured every send becomes a logged no-op —
callers report `emailSent: false` and fall back to copy-the-link flows, so
invites still work on self-hosted deployments with no email provider.
"""

import html
import logging

import httpx

from app.config import config

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def email_configured() -> bool:
    return bool(config.RESEND_API_KEY)


def send_email(to: str, subject: str, html_body: str) -> bool:
    """Send one email; returns True on acceptance by the provider.

    Never raises — invite creation must succeed even when the provider is
    down or unconfigured.
    """
    if not email_configured():
        logger.info("email: RESEND_API_KEY not set, skipping send to %s (%s)", to, subject)
        return False
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={"from": config.EMAIL_FROM, "to": [to], "subject": subject, "html": html_body},
            timeout=10.0,
        )
        if resp.status_code in (200, 201):
            return True
        logger.warning("email: send to %s failed: %s %s", to, resp.status_code, resp.text[:300])
        return False
    except Exception as e:  # noqa: BLE001 — network errors must not break invites
        logger.warning("email: send to %s failed: %s", to, e)
        return False


def send_invite_email(
    to: str,
    workspace_name: str,
    role: str,
    invite_url: str,
    invited_by: str | None,
) -> bool:
    """The workspace-invitation email: who invited you, to what, one button."""
    ws = html.escape(workspace_name)
    inviter = html.escape(invited_by) if invited_by else None
    intro = (
        f"{inviter} has invited you to join <strong>{ws}</strong>"
        if inviter
        else f"You've been invited to join <strong>{ws}</strong>"
    )
    body = f"""\
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b">
  <h2 style="margin:0 0 16px;font-size:20px">Join {ws} on OpenAgents</h2>
  <p style="margin:0 0 8px;font-size:14px;line-height:1.6">{intro} as a <strong>{html.escape(role)}</strong>.</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6">Sign in with this email address to accept the invitation.</p>
  <a href="{html.escape(invite_url)}"
     style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">
    Accept invitation</a>
  <p style="margin:24px 0 0;font-size:12px;color:#71717a;line-height:1.6">
    Or paste this link into your browser:<br>
    <a href="{html.escape(invite_url)}" style="color:#71717a">{html.escape(invite_url)}</a></p>
  <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">
    If you weren't expecting this invitation, you can ignore this email.</p>
</div>"""
    return send_email(to, f"You've been invited to {workspace_name} on OpenAgents", body)


def send_setup_email(to_email: str, workspace_name: str, link: str) -> bool:
    """The "finish on your computer" email — sent from the mobile app so the
    user has a one-click path to their workspace on a desktop, where they can
    download the launcher and pair their machine."""
    ws = html.escape(workspace_name)
    url = html.escape(link)
    body = f"""\
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b">
  <h2 style="margin:0 0 16px;font-size:20px">Finish setting up {ws}</h2>
  <p style="margin:0 0 8px;font-size:14px;line-height:1.6">
    Your workspace <strong>{ws}</strong> is ready — it just needs a computer to run your agents on.</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6">
    Open this link on your computer to download the OpenAgents launcher and pair it with your workspace. It takes about 2 minutes.</p>
  <a href="{url}"
     style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">
    Open your workspace</a>
  <p style="margin:24px 0 0;font-size:12px;color:#71717a;line-height:1.6">
    Or paste this link into your browser:<br>
    <a href="{url}" style="color:#71717a">{url}</a></p>
  <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">
    You requested this email from the OpenAgents mobile app.</p>
</div>"""
    return send_email(
        to_email, "Finish setting up your OpenAgents workspace (2 minutes)", body
    )


def send_onboarding_reminder(to_email: str, workspace_name: str, link: str, stage: str) -> bool:
    """Nudge the owner of a fresh workspace that has no connected computer yet.

    `stage` is "24h" or "72h" — same CTA, slightly firmer copy the second
    (and last) time.
    """
    ws = html.escape(workspace_name)
    url = html.escape(link)
    if stage == "72h":
        subject = f"Your OpenAgents workspace {workspace_name} is still waiting"
        intro = (
            f"Your workspace <strong>{ws}</strong> still isn't connected to a computer, "
            "so your agents have nowhere to run. This is our last reminder."
        )
    else:
        subject = f"One step left to get {workspace_name} running"
        intro = (
            f"You created <strong>{ws}</strong>, but it isn't connected to a computer yet — "
            "that's the step that brings your agents to life."
        )
    body = f"""\
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b">
  <h2 style="margin:0 0 16px;font-size:20px">Connect a computer to {ws}</h2>
  <p style="margin:0 0 8px;font-size:14px;line-height:1.6">{intro}</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6">
    Open your workspace on your computer, download the launcher and pair it — about 2 minutes.</p>
  <a href="{url}"
     style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">
    Open your workspace</a>
  <p style="margin:24px 0 0;font-size:12px;color:#71717a;line-height:1.6">
    Or paste this link into your browser:<br>
    <a href="{url}" style="color:#71717a">{url}</a></p>
  <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">
    You're receiving this because you created a workspace on OpenAgents.</p>
</div>"""
    return send_email(to_email, subject, body)
