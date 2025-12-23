Contributors:  @Hongmeng Li @Quan Cheng @Krane Bai (support) 
== Overview / Objective / Timeline

Enable the admin users to configure the network profile directly inside the OpenAgents Studio. Similar to the agent management tab, the Network Profile tab should only appear when the user is logged in using admin agent group.

network_profile:
  discoverable: true <- configurable 
  name: "Work Test Workspace" <- configurable 
  description: "A test workspace for collaborative work and productivity features including messaging, documents, forum, and wiki" <- configurable 
  icon: "https://openagents.org/icons/work-test.png" <- configurable 
  website: "https://openagents.org" <- configurable 
  tags: <- configurable 
    - "work"
    - "test"
    - "workspace"
    - "collaboration"
    - "productivity"
    - "wiki"
    - "knowledge-base"
  categories: <- configurable 
    - "productivity"
    - "collaboration"
    - "testing"
    - "knowledge-base"
  country: "Worldwide" <- configurable 
  required_openagents_version: "0.5.1" <- configurable 
  capacity: 100 <- configurable 
  host: "0.0.0.0" <- configurable 
  port: 8700 <- configurable, by default, this should be the port for HTTP transport


== Functional Requirements

Note that the frontend is already able to retrieve network profile through /api/health. Therefore, we don't need to add a new interface for retrieving the netowrk profile 

A new system-level operational event needs to be added:

system.update_network_profile
- Payload
  - Profile - dictionary, with keys to be updated and corresponding values

When this event is triggered, directly update the corresponding fields in the network configuration yaml file and also update the network profile loaded in the memory (system). This means that the update is a real-time update.

== UX Requirements
Add a new tab and display only when  the agent is logged in with the admin agent group.

![Network Profile Management](images/network_profile_management.png)

== Metrics
N/A

== Estimates and Records
Workstream
Estimate
Frontend
1PD
Backend
1PD

Date
PRD Start
October 27
Implementation Start

PR Complete

Feature Complete

== Meeting Notes
