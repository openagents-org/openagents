"""Synthetic provider probe: in-memory database, no real agent or user data."""
import asyncio
from datetime import datetime, timezone
from tests.conftest import engine, TestingSessionLocal
from app.database import Base
from app.models import Workspace, WorkspaceMember, Channel, ChannelMember
from app.mods.workspace_mod import _route_with_llm
from openagents.core.onm_events import Event
Base.metadata.create_all(engine)
with TestingSessionLocal() as db:
    ws = Workspace(name='Upgrade routing probe', creator_email='owner@example.test')
    db.add(ws); db.flush()
    ch = Channel(workspace_id=ws.id, name='probe', visibility='public', owner_email=ws.creator_email)
    db.add(ch); db.flush()
    for name, description in [('executor', 'Implements code changes and fixes bugs.'), ('reviewer', 'Reviews code changes for correctness and security; does not implement.')]:
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, description=description, owner_email=ws.creator_email, status='online', last_heartbeat=datetime.now(timezone.utc)))
        db.add(ChannelMember(channel_id=ch.id, agent_name=name))
    db.commit(); db.refresh(ch)
    cases = [('implementation', 'Please implement pagination for the users API.', ['executor']),
             ('review', 'Please review the code changes for correctness and security.', ['reviewer']),
             ('human-chat', 'Thanks Alex, see you at lunch!', [])]
    for name, content, expected in cases:
        event = Event(type='workspace.message.posted', source='human:owner@example.test', target='channel/probe', payload={'content':content,'sender_email':ws.creator_email})
        targets = asyncio.run(_route_with_llm(ch,event,db,ws,allow_human_stop=True))
        assert targets == expected, f'{name}: unexpected routing {targets}'
        print(name + ': passed', flush=True)
