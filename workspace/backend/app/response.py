# -*- coding: utf-8 -*-
"""
Response helpers for the workspace API.
"""

from enum import IntEnum
from typing import Any, Optional

from fastapi.responses import JSONResponse


class ResponseCode(IntEnum):
    SUCCESS = 0
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    CONFLICT = 409
    GONE = 410
    INTERNAL_ERROR = 500


def success_response(data: Any = None, message: str = "ok") -> dict:
    """Return a standard success response."""
    return {"code": ResponseCode.SUCCESS, "message": message, "data": data}


def json_response(
    code: ResponseCode,
    message: str,
    data: Any = None,
    status_code: Optional[int] = None,
) -> JSONResponse:
    """Return a JSON response with a specific code."""
    http_status = status_code or (200 if code == ResponseCode.SUCCESS else int(code))
    return JSONResponse(
        status_code=http_status,
        content={"code": int(code), "message": message, "data": data},
    )
