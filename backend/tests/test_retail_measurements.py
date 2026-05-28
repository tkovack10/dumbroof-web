#!/usr/bin/env python3
"""Ship 0.5 — retail vision-call telemetry wiring.

retail_measurements._call_claude must route through telemetry.call_claude_logged when an `sb`
client is supplied (so retail vision spend lands in processing_logs), logging with claim_id=None
(retail is a standalone pre-claim tool). Without `sb` it must keep its self-contained direct
path (full isolation preserved for standalone/test use).

Runs with pytest if available, else as a plain script:
    python3 backend/tests/test_retail_measurements.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import retail_measurements  # noqa: E402
import telemetry  # noqa: E402


class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeMsg:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


class _FakeMessages:
    def __init__(self, text):
        self._text = text
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeMsg(self._text)


class _FakeClient:
    def __init__(self, text="{}"):
        self.messages = _FakeMessages(text)


def test_retail_logs_via_call_claude_logged_when_sb_present():
    recorded = {}

    def fake_logged(client, sb, claim_id, step_name=None, **kwargs):
        recorded.update(sb=sb, claim_id=claim_id, step_name=step_name, kwargs=kwargs)
        return _FakeMsg('{"roof_area_sq": 20}')

    orig = telemetry.call_claude_logged
    telemetry.call_claude_logged = fake_logged
    try:
        client = _FakeClient()
        sentinel_sb = object()
        out = retail_measurements._call_claude(client, "B64", "PROMPT", sb=sentinel_sb)
        assert out == '{"roof_area_sq": 20}'
        assert recorded["sb"] is sentinel_sb
        assert recorded["claim_id"] is None, "retail telemetry must log with claim_id=None"
        assert recorded["step_name"] == "retail_measurements"
        # When telemetry is used, the direct client path must NOT also fire (no double call)
        assert client.messages.calls == []
    finally:
        telemetry.call_claude_logged = orig


def test_retail_direct_path_when_no_sb():
    # No sb → self-contained direct call, no telemetry import/use.
    client = _FakeClient('{"roof_area_sq": 5}')
    out = retail_measurements._call_claude(client, "B64", "PROMPT")
    assert out == '{"roof_area_sq": 5}'
    assert len(client.messages.calls) == 1, "no-sb path must call client.messages.create directly"


def test_extract_threads_sb_through():
    # extract_retail_measurements must forward sb to _call_claude.
    seen = {}

    def fake_call(client, pdf_b64, prompt, max_retries=3, sb=None):
        seen["sb"] = sb
        return '{"roof_area_sq": 30, "eave_lf": 100}'

    orig = retail_measurements._call_claude
    retail_measurements._call_claude = fake_call
    # _file_to_base64 reads a real path — stub it too so we don't need a fixture PDF.
    orig_b64 = retail_measurements._file_to_base64
    retail_measurements._file_to_base64 = lambda p: "B64"
    try:
        sentinel = object()
        out = retail_measurements.extract_retail_measurements(_FakeClient(), "x.pdf", sb=sentinel)
        assert seen["sb"] is sentinel
        assert out["roof_area_sq"] == 30.0 and out["eave_lf"] == 100.0
    finally:
        retail_measurements._call_claude = orig
        retail_measurements._file_to_base64 = orig_b64


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
