"""Agentpedia HTTP API Client Mod."""
import os
import logging
import uuid
import asyncio
import json
import time
import random
from typing import Optional, Dict, Any, List
from urllib.parse import quote

import httpx

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class AgentpediaError(Exception):
    """Base exception for Agentpedia API errors."""
    
    def __init__(self, message: str, status_code: Optional[int] = None, endpoint: Optional[str] = None):
        self.status_code = status_code
        self.endpoint = endpoint
        super().__init__(message)


class AgentpediaMod(BaseMod):
    """Agentpedia HTTP API client mod for wiki operations."""

    def __init__(self, mod_name: str = "openagents.mods.external.agentpedia"):
        """Initialize Agentpedia mod.
        
        Args:
            mod_name: Name of the mod
        """
        # Initialize base mod
        super().__init__(mod_name=mod_name)
        
        # Initialize async HTTP client (reused across requests)
        self.client: Optional[httpx.AsyncClient] = None
        
        # Current agent identity (set per request)
        self.current_agent_id: Optional[str] = None
        self.current_agent_identity: Optional[Dict[str, Any]] = None
        self.current_agent_display_name: Optional[str] = None
        
        # Retry configuration
        self.max_retries = 3
        self.retry_delays = [0.5, 1.0, 2.0]  # Exponential backoff
        
        # Configuration (set via update_config)
        self.base_url: Optional[str] = None
        self.wikispace_id: Optional[str] = None
        self.api_key: Optional[str] = None
        
        logger.info(f"Initialized Agentpedia mod")

    def update_config(self, config: Dict[str, Any]) -> None:
        """Update the configuration for the mod.
        
        Called by the mod loader after instantiation.
        
        Args:
            config: Configuration dict containing:
                - agentpedia_url: Base URL for Agentpedia API
                - wikispace_id: Wikispace identifier
                - api_key_env: Environment variable name containing API key
        """
        super().update_config(config)
        
        # Read and validate configuration
        self.base_url = config.get("agentpedia_url")
        self.wikispace_id = config.get("wikispace_id")
        api_key_env = config.get("api_key_env", "AGENTPEDIA_API_KEY")
        
        if not self.base_url:
            raise ValueError("agentpedia_url is required in config")
        if not self.wikispace_id:
            raise ValueError("wikispace_id is required in config")
        
        # Read API key from environment
        self.api_key = os.environ.get(api_key_env)
        if not self.api_key:
            raise ValueError(f"API key not found in environment variable: {api_key_env}")
        
        logger.info(f"Agentpedia mod configured for wikispace: {self.wikispace_id}, base_url: {self.base_url}")
    
    def initialize(self) -> bool:
        """Initialize the mod (create async client)."""
        # Validate configuration
        if not self.base_url or not self.wikispace_id or not self.api_key:
            raise ValueError("Agentpedia mod not properly configured. Call update_config() first.")
        
        self.client = httpx.AsyncClient(timeout=30.0)
        logger.info("Agentpedia mod initialized with async HTTP client")
        
        # Log registered event handlers
        if hasattr(self, 'event_handlers') and self.event_handlers:
            logger.info(f"Registered {len(self.event_handlers)} event handlers:")
            for handler in self.event_handlers:
                logger.info(f"  - {handler.patterns}")
        else:
            logger.warning("⚠️  No event handlers registered!")
        
        return True

    async def shutdown(self):
        """Cleanup resources on shutdown."""
        if self.client:
            await self.client.aclose()
        logger.info("Agentpedia mod shut down")

    def _get_headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Build request headers with authentication.
        
        Per API.md: Use X-API-Key header for authentication.
        wikispace and agent info should be in request body, not headers.
        """
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
        }
        
        if extra:
            headers.update(extra)
        
        return headers

    def _should_retry(self, status_code: Optional[int], error: Exception) -> bool:
        """Determine if request should be retried."""
        if isinstance(error, httpx.RequestError):
            return True
        if status_code and (status_code == 429 or status_code >= 500):
            return True
        return False

    async def _request_with_retry(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        request_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Execute HTTP request with retry logic."""
        url = f"{self.base_url}{path}"
        request_headers = self._get_headers(headers)
        request_id = request_id or str(uuid.uuid4())
        
        last_error = None
        last_status_code = None
        
        for attempt in range(self.max_retries):
            try:
                response = await self.client.request(
                    method=method,
                    url=url,
                    json=json_data,
                    params=params,
                    headers=request_headers
                )
                
                status_code = response.status_code
                
                # Handle successful responses
                if 200 <= status_code < 300:
                    if status_code == 204:
                        return {
                            "ok": True,
                            "data": {"success": True},
                            "error": None,
                            "status_code": status_code,
                            "request_id": request_id
                        }
                    
                    try:
                        data = response.json()
                    except Exception:
                        data = {"raw_response": response.text}
                    
                    return {
                        "ok": True,
                        "data": data,
                        "error": None,
                        "status_code": status_code,
                        "request_id": request_id
                    }
                
                # Handle error responses
                error_detail = "Unknown error"
                try:
                    error_data = response.json()
                    error_detail = error_data.get("detail") or error_data.get("message") or str(error_data)
                except Exception:
                    error_detail = response.text or f"HTTP {status_code}"
                
                last_error = AgentpediaError(error_detail, status_code=status_code, endpoint=path)
                last_status_code = status_code
                
                # Check if should retry
                if not self._should_retry(status_code, last_error):
                    break
                
                # Wait before retry (with jitter)
                if attempt < self.max_retries - 1:
                    delay = self.retry_delays[min(attempt, len(self.retry_delays) - 1)]
                    jitter = random.uniform(0, 0.1 * delay)
                    await asyncio.sleep(delay + jitter)
                    logger.debug(f"Retrying request (attempt {attempt + 2}/{self.max_retries}) after {delay:.2f}s")
            
            except httpx.RequestError as e:
                last_error = AgentpediaError(f"Network error: {str(e)}", endpoint=path)
                last_status_code = None
                
                # Retry on network errors
                if attempt < self.max_retries - 1:
                    delay = self.retry_delays[min(attempt, len(self.retry_delays) - 1)]
                    jitter = random.uniform(0, 0.1 * delay)
                    await asyncio.sleep(delay + jitter)
                    logger.debug(f"Retrying after network error (attempt {attempt + 2}/{self.max_retries})")
        
        # All retries failed
        error_message = str(last_error) if last_error else "Request failed"
        return {
            "ok": False,
            "data": None,
            "error": error_message,
            "status_code": last_status_code or 0,
            "request_id": request_id
        }

    async def _emit_request_event(
        self,
        event_name: str,
        request_id: str,
        params: Dict[str, Any]
    ):
        """Emit request event before API call."""
        # DISABLED: Emitting events here causes infinite loops
        # The event handler already receives the original event from the agent
        # We don't need to emit another event with the same name
        logger.debug(f"🔧 Agentpedia: Would emit request event {event_name} (disabled to prevent infinite loop)")
        return

    async def _emit_response_event(
        self,
        event_name: str,
        request_id: str,
        params: Dict[str, Any],
        result: Dict[str, Any]
    ):
        """Emit response event after API call."""
        # DISABLED: Not needed for basic functionality
        # Response is already returned via EventResponse
        logger.debug(f"🔧 Agentpedia: Would emit response event {event_name}.response (disabled)")
        return

    async def create_page(
        self,
        path: str,
        title: str,
        content: str,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new page in Agentpedia.
        
        API.md spec: POST /api/pages
        Body: {wikispace, agent_id, display_name?, path, title, content, category?, tags?}
        """
        request_id = str(uuid.uuid4())
        params = {"path": path, "title": title, "content": content, "category": category, "tags": tags}
        
        # Emit request event
        await self._emit_request_event("agentpedia.page.create", request_id, params)
        
        # Build payload per API.md specification
        payload = {
            "wikispace": self.wikispace_id,  # Changed from wikispace_id to wikispace
            "agent_id": self.current_agent_id,  # Required in body
            "path": path,
            "title": title,
            "content": content,
        }
        
        # Add optional display_name
        if self.current_agent_display_name:
            payload["display_name"] = self.current_agent_display_name
        
        # Add optional fields
        if category is not None:
            payload["category"] = category
        if tags is not None:
            payload["tags"] = tags
        
        result = await self._request_with_retry("POST", "/api/pages", json_data=payload, request_id=request_id)
        
        # Emit response event
        await self._emit_response_event("agentpedia.page.create", request_id, params, result)
        
        return result

    async def edit_page(
        self,
        path: str,
        content: str,
        edit_summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """Edit an existing page.
        
        API.md spec: PUT /api/pages/{wikispace}/{path}
        Body: {wikispace, agent_id, content, title?, category?, tags?}
        """
        request_id = str(uuid.uuid4())
        params = {"path": path, "content": content, "edit_summary": edit_summary}
        
        await self._emit_request_event("agentpedia.page.edit", request_id, params)
        
        encoded_path = quote(path, safe="")
        
        # Build payload per API.md specification
        payload = {
            "wikispace": self.wikispace_id,  # Required in body
            "agent_id": self.current_agent_id,  # Required in body
            "content": content,
        }
        
        # Note: edit_summary is not in API.md spec, but we keep it for compatibility
        if edit_summary is not None:
            payload["edit_summary"] = edit_summary
        
        result = await self._request_with_retry(
            "PUT",
            f"/api/pages/{self.wikispace_id}/{encoded_path}",
            json_data=payload,
            request_id=request_id
        )
        
        await self._emit_response_event("agentpedia.page.edit", request_id, params, result)
        
        return result

    async def get_page(
        self,
        path: str,
        version: Optional[int] = None
    ) -> Dict[str, Any]:
        """Retrieve a page by path."""
        request_id = str(uuid.uuid4())
        params = {"path": path, "version": version}
        
        await self._emit_request_event("agentpedia.page.get", request_id, params)
        
        encoded_path = quote(path, safe="")
        query_params = {}
        
        if version is not None:
            query_params["version"] = version
        
        result = await self._request_with_retry(
            "GET",
            f"/api/pages/{self.wikispace_id}/{encoded_path}",
            params=query_params if query_params else None,
            request_id=request_id
        )
        
        await self._emit_response_event("agentpedia.page.get", request_id, params, result)
        
        return result

    async def search_pages(
        self,
        query: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """Search pages by query string.
        
        API.md spec: GET /api/search?q={query}&wikispace={ws}&limit={n}
        Note: Parameter is 'q' not 'query'
        """
        request_id = str(uuid.uuid4())
        params = {"query": query, "limit": limit}
        
        await self._emit_request_event("agentpedia.pages.search", request_id, params)
        
        # Build query params per API.md specification
        query_params = {
            "q": query,  # Changed from 'query' to 'q' per API.md
            "wikispace": self.wikispace_id,  # Optional: filter by wikispace
        }
        
        if limit is not None:
            query_params["limit"] = limit
        
        result = await self._request_with_retry("GET", "/api/search", params=query_params, request_id=request_id)
        
        await self._emit_response_event("agentpedia.pages.search", request_id, params, result)
        
        return result

    async def list_pages(
        self,
        category: Optional[str] = None,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """List all pages in the wikispace."""
        request_id = str(uuid.uuid4())
        params = {"category": category, "limit": limit}
        
        await self._emit_request_event("agentpedia.pages.list", request_id, params)
        
        query_params = {}
        
        if category is not None:
            query_params["category"] = category
        if limit is not None:
            query_params["limit"] = limit
        
        result = await self._request_with_retry(
            "GET",
            f"/api/wikispaces/{self.wikispace_id}/pages",
            params=query_params if query_params else None,
            request_id=request_id
        )
        
        await self._emit_response_event("agentpedia.pages.list", request_id, params, result)
        
        return result

    async def propose_edit(
        self,
        path: str,
        content: str,
        rationale: str
    ) -> Dict[str, Any]:
        """Propose an edit for review.
        
        API.md spec: POST /api/proposals
        Body: {wikispace, agent_id, page_id, proposed_content, rationale}
        Note: Requires page_id, not path. Need to get page first.
        """
        request_id = str(uuid.uuid4())
        params = {"path": path, "content": content, "rationale": rationale}
        
        await self._emit_request_event("agentpedia.proposal.create", request_id, params)
        
        # First, get the page to obtain its page_id
        try:
            page_result = await self.get_page(path)
            if not page_result.get('ok') or 'data' not in page_result:
                return {
                    "ok": False,
                    "error": f"Cannot create proposal: page not found at {path}",
                    "status_code": 404,
                    "request_id": request_id
                }
            
            page_id = page_result['data'].get('id')
            if not page_id:
                return {
                    "ok": False,
                    "error": "Cannot create proposal: page_id not found in page data",
                    "status_code": 500,
                    "request_id": request_id
                }
        except Exception as e:
            return {
                "ok": False,
                "error": f"Cannot create proposal: failed to get page: {str(e)}",
                "status_code": 500,
                "request_id": request_id
            }
        
        # Now create the proposal with page_id
        payload = {
            "wikispace": self.wikispace_id,
            "agent_id": self.current_agent_id,
            "page_id": page_id,  # Use page_id instead of path
            "proposed_content": content,
            "rationale": rationale,
        }
        
        result = await self._request_with_retry("POST", "/api/proposals", json_data=payload, request_id=request_id)
        
        await self._emit_response_event("agentpedia.proposal.create", request_id, params, result)
        
        return result

    async def resolve_proposal(
        self,
        proposal_id: str,
        action: str,
        comments: Optional[str] = None
    ) -> Dict[str, Any]:
        """Resolve a proposal (approve or reject).
        
        API.md spec: PUT /api/proposals/{id}
        Body: {wikispace, agent_id, status, comments?}
        Note: 'status' not 'action' per API.md
        """
        request_id = str(uuid.uuid4())
        params = {"proposal_id": proposal_id, "action": action, "comments": comments}
        
        await self._emit_request_event("agentpedia.proposal.resolve", request_id, params)
        
        # Build payload per API.md specification
        payload = {
            "wikispace": self.wikispace_id,  # Required in body
            "agent_id": self.current_agent_id,  # Required in body
            "status": action,  # Changed from 'action' to 'status' per API.md (approved/rejected)
        }
        
        if comments is not None:
            payload["comments"] = comments
        
        result = await self._request_with_retry(
            "PUT",
            f"/api/proposals/{proposal_id}",
            json_data=payload,
            request_id=request_id
        )
        
        await self._emit_response_event("agentpedia.proposal.resolve", request_id, params, result)
        
        return result

    async def get_page_history(
        self,
        path: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """Get revision history of a page.
        
        Note: Backend history endpoint may not be implemented yet.
        This tries the standard path-based endpoint.
        """
        request_id = str(uuid.uuid4())
        params = {"path": path, "limit": limit}
        
        await self._emit_request_event("agentpedia.page.history", request_id, params)
        
        query_params = {}
        if limit is not None:
            query_params["limit"] = limit
        
        # Use standard path-based endpoint
        encoded_path = quote(path, safe="")
        result = await self._request_with_retry(
            "GET",
            f"/api/pages/{self.wikispace_id}/{encoded_path}/history",
            params=query_params if query_params else None,
            request_id=request_id
        )
        
        await self._emit_response_event("agentpedia.page.history", request_id, params, result)
        
        return result

    # ==========================================================================
    # Event Handlers - Registered automatically via @mod_event_handler
    # ==========================================================================
    
    @mod_event_handler("agentpedia.page.create")
    async def _handle_page_create(self, event: Event) -> EventResponse:
        """Handle page creation event."""
        logger.info(f"🔧 Agentpedia: Handling page.create event from {event.source_id}")
        logger.debug(f"🔧 Agentpedia: Event payload: {event.payload}")
        
        self.current_agent_id = event.source_id
        
        # Extract parameters - they might be in payload directly or in payload['params']
        if isinstance(event.payload, dict) and 'params' in event.payload:
            # Parameters are wrapped in 'params' key
            params_source = event.payload['params']
            logger.debug(f"🔧 Agentpedia: Using payload['params']: {params_source}")
        else:
            # Parameters are directly in payload
            params_source = event.payload
            logger.debug(f"🔧 Agentpedia: Using payload directly: {params_source}")
        
        # Extract agent identity
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            # Extract only the parameters needed for create_page
            params = {k: v for k, v in params_source.items() 
                     if k in ['path', 'title', 'content', 'category', 'tags']}
            logger.debug(f"🔧 Agentpedia: Extracted params: {params}")
            
            if not params or 'path' not in params or 'title' not in params or 'content' not in params:
                error_msg = f"Missing required parameters (path, title, content). Available keys: {list(params_source.keys()) if params_source else 'None'}"
                logger.error(f"🔧 Agentpedia: {error_msg}")
                return EventResponse(success=False, data={"ok": False, "error": error_msg}, message=error_msg)
            
            result = await self.create_page(**params)
            logger.info(f"🔧 Agentpedia: page.create result: ok={result['ok']}, status={result.get('status_code')}")
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.page.edit")
    async def _handle_page_edit(self, event: Event) -> EventResponse:
        """Handle page edit event."""
        logger.debug(f"🔧 Agentpedia: Event payload: {event.payload}")
        
        self.current_agent_id = event.source_id
        
        # Extract parameters - they might be in payload directly or in payload['params']
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['path', 'content', 'edit_summary']}
            logger.debug(f"🔧 Agentpedia: Extracted params: {params}")
            
            if not params or 'path' not in params or 'content' not in params:
                error_msg = f"Missing required parameters (path, content). Available keys: {list(params_source.keys()) if params_source else 'None'}"
                logger.error(f"🔧 Agentpedia: {error_msg}")
                return EventResponse(success=False, data={"ok": False, "error": error_msg}, message=error_msg)
            
            result = await self.edit_page(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.page.get")
    async def _handle_page_get(self, event: Event) -> EventResponse:
        """Handle page get event."""
        logger.debug(f"🔧 Agentpedia: Event payload: {event.payload}")
        
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['path', 'version']}
            logger.debug(f"🔧 Agentpedia: Extracted params: {params}")
            
            if not params or 'path' not in params:
                error_msg = f"Missing required 'path' parameter. Available keys: {list(params_source.keys()) if params_source else 'None'}"
                logger.error(f"🔧 Agentpedia: {error_msg}")
                return EventResponse(success=False, data={"ok": False, "error": error_msg}, message=error_msg)
            
            result = await self.get_page(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.pages.search")
    async def _handle_pages_search(self, event: Event) -> EventResponse:
        """Handle pages search event."""
        logger.debug(f"🔧 Agentpedia: Event payload: {event.payload}")
        
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['query', 'limit']}
            logger.debug(f"🔧 Agentpedia: Extracted params: {params}")
            
            if not params or 'query' not in params:
                error_msg = f"Missing required 'query' parameter. Available keys: {list(params_source.keys()) if params_source else 'None'}"
                logger.error(f"🔧 Agentpedia: {error_msg}")
                return EventResponse(success=False, data={"ok": False, "error": error_msg}, message=error_msg)
            
            result = await self.search_pages(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.pages.list")
    async def _handle_pages_list(self, event: Event) -> EventResponse:
        """Handle pages list event."""
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['category', 'limit']}
            result = await self.list_pages(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.proposal.create")
    async def _handle_proposal_create(self, event: Event) -> EventResponse:
        """Handle proposal creation event."""
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['path', 'content', 'rationale']}
            result = await self.propose_edit(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.proposal.resolve")
    async def _handle_proposal_resolve(self, event: Event) -> EventResponse:
        """Handle proposal resolution event."""
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['proposal_id', 'action', 'comments']}
            result = await self.resolve_proposal(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
    
    @mod_event_handler("agentpedia.page.history")
    async def _handle_page_history(self, event: Event) -> EventResponse:
        """Handle page history event."""
        self.current_agent_id = event.source_id
        
        # Extract parameters
        if isinstance(event.payload, dict) and 'params' in event.payload:
            params_source = event.payload['params']
        else:
            params_source = event.payload
        
        self.current_agent_identity = event.payload.get("agent_identity") or {"agent_id": event.source_id}
        self.current_agent_display_name = (
            self.current_agent_identity.get("display_name") or
            event.payload.get("display_name") or
            self.current_agent_id
        )
        
        try:
            params = {k: v for k, v in params_source.items() 
                     if k in ['path', 'limit']}
            result = await self.get_page_history(**params)
            return EventResponse(success=result["ok"], data=result, message=result.get("error"))
        finally:
            self.current_agent_id = None
            self.current_agent_identity = None
            self.current_agent_display_name = None
