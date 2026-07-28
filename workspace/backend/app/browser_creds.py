# -*- coding: utf-8 -*-
"""
Browser Fabric credential references — resolve, verify, redact.

`browser_tabs` never stores a BF API key in plaintext. Each tab records:

  - `bf_key_source`      — 'workspace' (workspace.settings.browserfabric_api_key)
                           or 'global' (BROWSERFABRIC_API_KEY env var);
                           NULL for local-mode tabs / pre-migration rows.
  - `bf_key_fingerprint` — full SHA-256 hex of the key the session was
                           created with, for rotation detection and quota
                           attribution. A hash is stored, never the key.

`resolve_tab_key` is the single path every session operation (close,
reconnect, persist, navigate, click, type, screenshot, snapshot, page
info) uses to turn that reference back into a real key. If the resolved
key no longer matches the stored fingerprint, the credential was rotated
and the operation MUST NOT proceed with the new key against the old
session — callers get `BrowserCredentialError` instead of a silent
wrong-key call (accepted residual risk: rotated-away sessions can no
longer be closed by us).

Legacy rows (fingerprint NULL) skip the mismatch check but log that the
verification was bypassed.
"""

import hashlib
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SOURCE_WORKSPACE = "workspace"
SOURCE_GLOBAL = "global"


class BrowserCredentialError(Exception):
    """Credential reference cannot be resolved or no longer matches.

    `reason` is machine-readable: 'credential_missing' | 'credential_mismatch'.
    The message never contains key material.
    """

    def __init__(self, reason: str, detail: str):
        self.reason = reason
        super().__init__(f"{reason}: {detail}")


def key_fingerprint(key: Optional[str]) -> Optional[str]:
    """Full SHA-256 hex fingerprint of an API key (None for no key)."""
    if not key:
        return None
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def redact(text: Optional[str], *keys: Optional[str]) -> Optional[str]:
    """Strip any real key material from text before it is stored or logged."""
    if not text:
        return text
    for key in keys:
        if key and key in text:
            fp = key_fingerprint(key)
            text = text.replace(key, f"<bf-key:{fp[:12]}>")
    return text


def _current_key_for_source(source: Optional[str], workspace) -> Optional[str]:
    if source == SOURCE_WORKSPACE:
        if workspace is None:
            return None
        return (workspace.settings or {}).get("browserfabric_api_key")
    if source == SOURCE_GLOBAL:
        # Read at call time (not import time) so env changes and test
        # monkeypatching of app.browser.BROWSERFABRIC_API_KEY are honoured.
        from app import browser as browser_module
        return browser_module.BROWSERFABRIC_API_KEY or None
    return None


def resolve_tab_key(tab, workspace) -> Optional[str]:
    """Resolve the real BF API key for an existing tab's session.

    Returns the key (or None for local-mode tabs with no source).
    Raises BrowserCredentialError when the reference is broken:
      - credential_missing: the referenced source no longer holds a key;
      - credential_mismatch: the source's current key is not the key the
        session was created with (rotation) — do NOT use it on this session.
    """
    source = getattr(tab, "bf_key_source", None)
    stored_fp = getattr(tab, "bf_key_fingerprint", None)

    if source is None:
        # Legacy / local-mode row: best-effort fallback (workspace key then
        # global), preserving pre-migration behaviour. No fingerprint to
        # verify against; log so ops can trace unverified key use.
        key = _current_key_for_source(SOURCE_WORKSPACE, workspace) \
            or _current_key_for_source(SOURCE_GLOBAL, workspace)
        if key and stored_fp is None:
            logger.info(
                "browser.credential.unverified tab=%s: legacy row without key source; "
                "using fallback resolution", getattr(tab, "id", "?"),
            )
        return key

    key = _current_key_for_source(source, workspace)
    if not key:
        raise BrowserCredentialError(
            "credential_missing",
            f"tab {getattr(tab, 'id', '?')} references {source} BF key but none is configured",
        )

    if stored_fp:
        current_fp = key_fingerprint(key)
        if current_fp != stored_fp:
            logger.warning(
                "browser.credential.rotated tab=%s source=%s stored_fp=%s current_fp=%s",
                getattr(tab, "id", "?"), source, stored_fp[:12], current_fp[:12],
            )
            raise BrowserCredentialError(
                "credential_mismatch",
                f"tab {getattr(tab, 'id', '?')}: {source} BF key was rotated; "
                "refusing to operate on the old session with the new key",
            )
    else:
        logger.info(
            "browser.credential.unverified tab=%s: no stored fingerprint; skipping check",
            getattr(tab, "id", "?"),
        )
    return key
