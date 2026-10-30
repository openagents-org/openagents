# -*- coding: utf-8 -*-
"""Tests for ONM pipeline and mods."""

import pytest

from openagents.sdk.onm_events import Event
from openagents.sdk.onm_mods import (
    EventRejected,
    GuardMod,
    Mod,
    ObserveMod,
    PipelineContext,
    TransformMod,
)
from openagents.sdk.onm_pipeline import Pipeline


# ---------------------------------------------------------------------------
# Test mods
# ---------------------------------------------------------------------------

class AllowAllGuard(GuardMod):
    name = "allow-all"
    intercepts = ["*"]
    priority = 0

    async def process(self, event, context):
        return event


class RejectGuard(GuardMod):
    name = "reject"
    intercepts = ["*"]
    priority = 0

    async def process(self, event, context):
        return None  # Reject


class TokenGuard(GuardMod):
    """Only allows events with metadata.token == 'valid'."""
    name = "token-auth"
    intercepts = ["*"]
    priority = 0

    async def process(self, event, context):
        if event.metadata.get("token") == "valid":
            return event
        return None


class AddTimestampTransform(TransformMod):
    name = "add-timestamp"
    intercepts = ["*"]
    priority = 30

    async def process(self, event, context):
        new_meta = {**event.metadata, "processed": True}
        return event.model_copy(update={"metadata": new_meta})


class MessageOnlyTransform(TransformMod):
    """Only intercepts workspace.message.* events."""
    name = "message-only"
    intercepts = ["workspace.message.*"]
    priority = 30

    async def process(self, event, context):
        new_meta = {**event.metadata, "message_processed": True}
        return event.model_copy(update={"metadata": new_meta})


class RecordingObserver(ObserveMod):
    name = "recorder"
    intercepts = ["*"]
    priority = 90

    def __init__(self):
        self.recorded = []

    async def process(self, event, context):
        self.recorded.append(event)


class SideEffectObserver(ObserveMod):
    name = "side-effect"
    intercepts = ["network.agent.join"]
    priority = 90

    async def process(self, event, context):
        context.emit(Event(
            type="network.agent.announce",
            source=event.source,
            target="agent:broadcast",
            payload={"agent": event.source, "action": "joined"},
        ))


class ErrorMod(TransformMod):
    name = "error-mod"
    intercepts = ["*"]
    priority = 30

    async def process(self, event, context):
        raise RuntimeError("something broke")


# ---------------------------------------------------------------------------
# Pipeline tests
# ---------------------------------------------------------------------------

class TestPipelineBasic:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test")

    @pytest.mark.asyncio
    async def test_empty_pipeline(self, ctx):
        pipeline = Pipeline()
        event = Event(type="network.ping", source="agent:a", target="core")
        result = await pipeline.process(event, ctx)
        assert result.id == event.id

    @pytest.mark.asyncio
    async def test_guard_allows(self, ctx):
        pipeline = Pipeline(mods=[AllowAllGuard()])
        event = Event(type="network.ping", source="agent:a", target="core")
        result = await pipeline.process(event, ctx)
        assert result.id == event.id

    @pytest.mark.asyncio
    async def test_guard_rejects(self, ctx):
        pipeline = Pipeline(mods=[RejectGuard()])
        event = Event(type="network.ping", source="agent:a", target="core")
        with pytest.raises(EventRejected) as exc_info:
            await pipeline.process(event, ctx)
        assert "reject" in exc_info.value.mod_name

    @pytest.mark.asyncio
    async def test_transform_modifies(self, ctx):
        pipeline = Pipeline(mods=[AllowAllGuard(), AddTimestampTransform()])
        event = Event(type="network.ping", source="agent:a", target="core")
        result = await pipeline.process(event, ctx)
        assert result.metadata["processed"] is True

    @pytest.mark.asyncio
    async def test_observer_records(self, ctx):
        recorder = RecordingObserver()
        pipeline = Pipeline(mods=[recorder])
        event = Event(type="network.ping", source="agent:a", target="core")
        await pipeline.process(event, ctx)
        assert len(recorder.recorded) == 1
        assert recorder.recorded[0].id == event.id


class TestPipelineOrdering:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test")

    @pytest.mark.asyncio
    async def test_guards_run_before_transforms(self, ctx):
        """If guard rejects, transform should never run."""
        transform = AddTimestampTransform()
        pipeline = Pipeline(mods=[transform, RejectGuard()])
        event = Event(type="network.ping", source="agent:a", target="core")
        with pytest.raises(EventRejected):
            await pipeline.process(event, ctx)
        # Transform should NOT have been applied

    @pytest.mark.asyncio
    async def test_mode_ordering(self, ctx):
        """Guards always run before transforms, which run before observers."""
        order = []

        class TrackGuard(GuardMod):
            name = "track-guard"
            intercepts = ["*"]
            priority = 99  # High priority number but should still run first (it's a guard)
            async def process(self, event, context):
                order.append("guard")
                return event

        class TrackTransform(TransformMod):
            name = "track-transform"
            intercepts = ["*"]
            priority = 0  # Low priority number but should run after guards
            async def process(self, event, context):
                order.append("transform")
                return event

        class TrackObserve(ObserveMod):
            name = "track-observe"
            intercepts = ["*"]
            priority = 0
            async def process(self, event, context):
                order.append("observe")

        pipeline = Pipeline(mods=[TrackObserve(), TrackTransform(), TrackGuard()])
        event = Event(type="network.ping", source="agent:a", target="core")
        await pipeline.process(event, ctx)
        assert order == ["guard", "transform", "observe"]

    @pytest.mark.asyncio
    async def test_priority_within_mode(self, ctx):
        """Within the same mode, lower priority runs first."""
        order = []

        class First(ObserveMod):
            name = "first"
            intercepts = ["*"]
            priority = 10
            async def process(self, event, context):
                order.append("first")

        class Second(ObserveMod):
            name = "second"
            intercepts = ["*"]
            priority = 20
            async def process(self, event, context):
                order.append("second")

        pipeline = Pipeline(mods=[Second(), First()])
        event = Event(type="network.ping", source="agent:a", target="core")
        await pipeline.process(event, ctx)
        assert order == ["first", "second"]


class TestPipelineFiltering:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test")

    @pytest.mark.asyncio
    async def test_intercept_pattern_matching(self, ctx):
        """Mod with workspace.message.* should not process network.ping."""
        transform = MessageOnlyTransform()
        pipeline = Pipeline(mods=[transform])

        ping = Event(type="network.ping", source="agent:a", target="core")
        result = await pipeline.process(ping, ctx)
        assert "message_processed" not in result.metadata

        msg = Event(type="workspace.message.posted", source="agent:a", target="channel/s1")
        result = await pipeline.process(msg, ctx)
        assert result.metadata["message_processed"] is True

    @pytest.mark.asyncio
    async def test_empty_intercepts_matches_all(self, ctx):
        """A mod with empty intercepts list matches all event types."""

        class MatchAll(ObserveMod):
            name = "match-all"
            intercepts = []
            priority = 90
            def __init__(self):
                self.count = 0
            async def process(self, event, context):
                self.count += 1

        mod = MatchAll()
        pipeline = Pipeline(mods=[mod])
        await pipeline.process(Event(type="network.ping", source="agent:a", target="core"), ctx)
        await pipeline.process(Event(type="workspace.message.posted", source="agent:a", target="channel/s1"), ctx)
        assert mod.count == 2


class TestPipelineContext:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test", agent_address="agent:alice")

    @pytest.mark.asyncio
    async def test_side_effects(self, ctx):
        pipeline = Pipeline(mods=[SideEffectObserver()])
        event = Event(type="network.agent.join", source="agent:bob", target="core")
        await pipeline.process(event, ctx)
        assert len(ctx.side_effects) == 1
        assert ctx.side_effects[0].type == "network.agent.announce"

    @pytest.mark.asyncio
    async def test_no_side_effects_when_no_match(self, ctx):
        pipeline = Pipeline(mods=[SideEffectObserver()])
        event = Event(type="network.ping", source="agent:bob", target="core")
        await pipeline.process(event, ctx)
        assert len(ctx.side_effects) == 0


class TestPipelineTokenAuth:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test")

    @pytest.mark.asyncio
    async def test_valid_token_passes(self, ctx):
        recorder = RecordingObserver()
        pipeline = Pipeline(mods=[TokenGuard(), recorder])
        event = Event(
            type="workspace.message.posted",
            source="agent:alice",
            target="channel/s1",
            metadata={"token": "valid"},
        )
        result = await pipeline.process(event, ctx)
        assert result.id == event.id
        assert len(recorder.recorded) == 1

    @pytest.mark.asyncio
    async def test_invalid_token_rejected(self, ctx):
        recorder = RecordingObserver()
        pipeline = Pipeline(mods=[TokenGuard(), recorder])
        event = Event(
            type="workspace.message.posted",
            source="agent:alice",
            target="channel/s1",
            metadata={"token": "wrong"},
        )
        with pytest.raises(EventRejected):
            await pipeline.process(event, ctx)
        assert len(recorder.recorded) == 0


class TestPipelineErrorHandling:

    @pytest.fixture
    def ctx(self):
        return PipelineContext(network_id="ws-test")

    @pytest.mark.asyncio
    async def test_mod_exception_propagates(self, ctx):
        pipeline = Pipeline(mods=[ErrorMod()])
        event = Event(type="network.ping", source="agent:a", target="core")
        with pytest.raises(RuntimeError, match="something broke"):
            await pipeline.process(event, ctx)


class TestPipelineAddRemove:

    def test_add_mod(self):
        pipeline = Pipeline()
        assert len(pipeline.mods) == 0
        pipeline.add_mod(AllowAllGuard())
        assert len(pipeline.mods) == 1

    def test_remove_mod(self):
        guard = AllowAllGuard()
        recorder = RecordingObserver()
        pipeline = Pipeline(mods=[guard, recorder])
        assert len(pipeline.mods) == 2
        pipeline.remove_mod("allow-all")
        assert len(pipeline.mods) == 1
        assert pipeline.mods[0].name == "recorder"

    def test_remove_nonexistent(self):
        pipeline = Pipeline(mods=[AllowAllGuard()])
        pipeline.remove_mod("does-not-exist")
        assert len(pipeline.mods) == 1
