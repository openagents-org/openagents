# -*- coding: utf-8 -*-
"""Sharing (v1.1 M2) — thread participants, agent grants, directory, pins, requests.

Routes are added by the milestone that owns this file. Registered in
app/main.py up front so milestone branches never touch main.py.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["sharing"])
