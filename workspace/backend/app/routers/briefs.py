# -*- coding: utf-8 -*-
"""Work briefs (v1.1 M5) — the persistent shared brief per thread.

Routes are added by the milestone that owns this file. Registered in
app/main.py up front so milestone branches never touch main.py.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["briefs"])
