"""Streaming, caching, CORS and logging contracts for the lightweight middleware."""
import asyncio
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.main import NoTransformCompressionHeadersMiddleware, UserAgentLogMiddleware


@pytest.mark.parametrize('explicit', [None, b'no-cache, no-transform', b'no-store'])
def test_stream_chunks_and_explicit_cache_policy_preserved(explicit):
    messages = []
    original = [
        {'type':'http.response.start', 'status':200,
         'headers':[(b'content-type',b'text/event-stream')] + ([(b'cache-control',explicit)] if explicit else [])},
        {'type':'http.response.body', 'body':b'data: first\n\n', 'more_body':True},
        {'type':'http.response.body', 'body':b'data: second\n\n', 'more_body':False},
    ]
    async def endpoint(scope, receive, send):
        for message in original:
            await send(message)
    async def receive(): return {'type':'http.disconnect'}
    async def send(message): messages.append(message)
    wrapped = UserAgentLogMiddleware(NoTransformCompressionHeadersMiddleware(endpoint))
    asyncio.run(wrapped({'type':'http', 'method':'GET', 'path':'/stream', 'headers':[]}, receive, send))
    assert messages[1:] == original[1:]
    assert dict(messages[0]['headers'])[b'cache-control'] == (explicit or b'private, no-transform, max-age=0')
    assert len([k for k,v in messages[0]['headers'] if k == b'cache-control']) == 1


def test_gzip_cors_error_status_and_post_logging(caplog):
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=['https://workspace.openagents.org'])
    app.add_middleware(GZipMiddleware, minimum_size=100)
    app.add_middleware(NoTransformCompressionHeadersMiddleware)
    app.add_middleware(UserAgentLogMiddleware)
    @app.post('/echo', status_code=201)
    def echo(): return {'body':'x'*5000}
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        response = client.post('/echo', headers={'Origin':'https://workspace.openagents.org', 'User-Agent':'test-agent', 'Accept-Encoding':'gzip'})
        assert response.status_code == 201
        assert response.json() == {'body':'x'*5000}
        assert response.headers['content-encoding'] == 'gzip'
        assert response.headers['access-control-allow-origin'] == 'https://workspace.openagents.org'
        assert response.headers['cache-control'] == 'private, no-transform, max-age=0'
        error = client.get('/missing')
        assert error.status_code == 404
        assert error.headers['cache-control'] == 'private, no-transform, max-age=0'
    assert 'POST /echo ua=test-agent status=201' in caplog.text


def test_non_http_protocol_is_passed_through():
    seen=[]
    async def endpoint(scope, receive, send): seen.append(scope['type'])
    async def receive(): return {}
    async def send(message): pass
    wrapped=UserAgentLogMiddleware(NoTransformCompressionHeadersMiddleware(endpoint))
    asyncio.run(wrapped({'type':'websocket'},receive,send))
    assert seen==['websocket']
