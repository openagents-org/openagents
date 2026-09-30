# -*- coding: utf-8 -*-
"""Agent profile (v1.1 M4) — specialist profile for owners, teammates and the agent itself.

Routes are added by the milestone that owns this file. Registered in
app/main.py up front so milestone branches never touch main.py.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["agent_profile"])
