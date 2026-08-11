# -*- coding: utf-8 -*-
"""
Tests for the mobile version check (/v1/app/version).

The endpoint is public and config-driven, so these pin the two behaviours a
release depends on: the comparison against the caller's build, and the
refusal to force an update out of an unconfigured deployment.
"""

import pytest

from app.config import config


@pytest.fixture
def released(monkeypatch):
    """A configured Android release: 1.2.0 (build 30), floor at build 20."""
    monkeypatch.setattr(config, "APP_ANDROID_LATEST_VERSION", "1.2.0")
    monkeypatch.setattr(config, "APP_ANDROID_LATEST_BUILD", 30)
    monkeypatch.setattr(config, "APP_ANDROID_MIN_BUILD", 20)
    monkeypatch.setattr(config, "APP_ANDROID_UPDATE_URL", "https://example.com/app.apk")
    monkeypatch.setattr(config, "APP_ANDROID_RELEASE_NOTES", "Faster sync")


class TestAppVersion:
    def test_rejects_unknown_platform(self, client):
        resp = client.get("/v1/app/version", params={"platform": "windows"})
        assert resp.json()["code"] != 0

    def test_reports_the_released_build(self, client, released):
        data = client.get("/v1/app/version", params={"platform": "android"}).json()["data"]
        assert data["latest_version"] == "1.2.0"
        assert data["latest_build"] == 30
        assert data["min_build"] == 20
        assert data["url"] == "https://example.com/app.apk"
        assert data["notes"] == "Faster sync"

    def test_no_build_means_no_verdict(self, client, released):
        """A client that doesn't say what it is gets the numbers, not a verdict."""
        data = client.get("/v1/app/version", params={"platform": "android"}).json()["data"]
        assert data["update_available"] is False
        assert data["force_update"] is False

    def test_current_build_needs_nothing(self, client, released):
        data = client.get(
            "/v1/app/version", params={"platform": "android", "build": 30}
        ).json()["data"]
        assert data["update_available"] is False
        assert data["force_update"] is False

    def test_older_build_is_offered_an_update(self, client, released):
        data = client.get(
            "/v1/app/version", params={"platform": "android", "build": 25}
        ).json()["data"]
        assert data["update_available"] is True
        assert data["force_update"] is False

    def test_build_below_the_floor_is_forced(self, client, released):
        data = client.get(
            "/v1/app/version", params={"platform": "android", "build": 19}
        ).json()["data"]
        assert data["update_available"] is True
        assert data["force_update"] is True

    def test_a_newer_build_than_released_is_left_alone(self, client, released):
        """Internal builds run ahead of the store; they are not "out of date"."""
        data = client.get(
            "/v1/app/version", params={"platform": "android", "build": 99}
        ).json()["data"]
        assert data["update_available"] is False
        assert data["force_update"] is False

    def test_unconfigured_platform_never_forces(self, client, monkeypatch):
        monkeypatch.setattr(config, "APP_IOS_LATEST_BUILD", 0)
        monkeypatch.setattr(config, "APP_IOS_MIN_BUILD", 0)
        data = client.get(
            "/v1/app/version", params={"platform": "ios", "build": 1}
        ).json()["data"]
        assert data["update_available"] is False
        assert data["force_update"] is False

    def test_needs_no_credentials(self, client, released):
        """The app asks before it holds a workspace token."""
        resp = client.get("/v1/app/version", params={"platform": "android"})
        assert resp.status_code == 200
        assert resp.json()["code"] == 0
