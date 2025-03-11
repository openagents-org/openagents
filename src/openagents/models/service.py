"""Service models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, validator


class ServiceDefinition(BaseModel):
    """Definition of a service provided by an agent."""
    
    name: str = Field(..., description="Name of the service")
    description: str = Field("", description="Description of the service")
    version: str = Field("1.0.0", description="Version of the service")
    input_format: Optional[str] = Field(None, description="Format of the input data")
    output_format: Optional[str] = Field(None, description="Format of the output data")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters for the service")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    
    @validator('name')
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Service name must be a non-empty string')
        return v


class ServiceRequest(BaseModel):
    """Request to a service."""
    
    service: str = Field(..., description="Name of the service")
    operation: Optional[str] = Field(None, description="Operation to perform")
    data: Dict[str, Any] = Field(default_factory=dict, description="Input data")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Request parameters")


class ServiceResponse(BaseModel):
    """Response from a service."""
    
    service: str = Field(..., description="Name of the service")
    operation: Optional[str] = Field(None, description="Operation performed")
    status: str = Field("success", description="Status of the response")
    data: Dict[str, Any] = Field(default_factory=dict, description="Output data")
    error: Optional[str] = Field(None, description="Error message if status is error") 