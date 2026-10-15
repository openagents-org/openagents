"""Human message reactions; no message dispatch or agent triggers."""
from typing import Optional, Literal
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import EventRecord, MessageReaction, Channel
from app.routers.sharing import _load
from app.services.access_model import can_view_channel
from app.response import success_response

router = APIRouter(prefix="/v1/reactions", tags=["Reactions"])
Emoji = Literal['👍','❤️','😂','🎉','👀','✅','🙏','🚀']

class QueryInput(BaseModel):
    ids: list[str] = Field(max_length=200)

class ReactionInput(BaseModel):
    emoji: Emoji
    active: bool


def _visible(db, ctx, event):
    if not event or event.network_id != ctx.wid or event.type != 'workspace.message.posted' or not event.source.startswith('human:') or (event.payload or {}).get('message_type','chat') != 'chat':
        return False
    if event.target.startswith('channel/'):
        channel=db.execute(select(Channel).where(Channel.workspace_id==ctx.wid,Channel.name==event.target[8:],Channel.status!='deleted')).scalar_one_or_none()
        return bool(channel and can_view_channel(db,ctx.wid,ctx.viewer,channel))
    return f'human:{ctx.viewer.email}' in (event.source,event.target)


def _summary(db, ids, email):
    result={key:[] for key in ids}
    rows=db.execute(select(MessageReaction).where(MessageReaction.event_id.in_(ids))).scalars()
    grouped={}
    for row in rows:
        item=grouped.setdefault((row.event_id,row.emoji),{'emoji':row.emoji,'count':0,'mine':False})
        item['count']+=1
        item['mine'] |= row.user_email==email
    for (event_id,emoji), item in sorted(grouped.items()):
        result[event_id].append(item)
    return result

@router.post('/query')
def query_reactions(body: QueryInput, network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str]=Header(None), authorization: Optional[str]=Header(None)):
    ctx,err=_load(db,network,x_workspace_token,authorization)
    if err: return err
    if not ctx.viewer.is_human or not ctx.viewer.email:
        raise HTTPException(403,'Sign in to view reactions')
    events=db.execute(select(EventRecord).where(EventRecord.network_id==ctx.wid,EventRecord.id.in_(body.ids))).scalars()
    ids=[event.id for event in events if _visible(db,ctx,event)]
    return success_response(_summary(db,ids,ctx.viewer.email))

@router.put('/{event_id}')
def set_reaction(event_id: str, body: ReactionInput, network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str]=Header(None), authorization: Optional[str]=Header(None)):
    ctx,err=_load(db,network,x_workspace_token,authorization)
    if err: return err
    if not ctx.viewer.is_human or not ctx.viewer.email or ctx.role not in ('member','admin','owner'):
        raise HTTPException(403,'Sign in as a workspace member to react')
    # Lock the message so concurrent toggles cannot create duplicate reactions.
    event=db.execute(select(EventRecord).where(EventRecord.id==event_id,EventRecord.network_id==ctx.wid).with_for_update()).scalar_one_or_none()
    if not _visible(db,ctx,event):
        raise HTTPException(404,'Message not found')
    key=(event_id,ctx.viewer.email,body.emoji)
    existing=db.get(MessageReaction,key)
    if body.active and not existing:
        db.add(MessageReaction(event_id=event_id,user_email=ctx.viewer.email,emoji=body.emoji))
    elif not body.active and existing:
        db.delete(existing)
    db.commit()
    return success_response(_summary(db,[event_id],ctx.viewer.email)[event_id])
