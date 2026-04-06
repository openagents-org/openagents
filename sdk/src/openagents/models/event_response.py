from pydantic import BaseModel, Field
from typing import Dict, Any, Optional


class EventResponse(BaseModel):
    """Response message for events."""

    success: bool = Field(..., description="Whether the event was successful")
    message: Optional[str] = Field(None, description="Message of the event response")
    data: Optional[Any] = Field(None, description="Data of the event response")
    event_name: Optional[str] = Field(None, description="Original event name")
