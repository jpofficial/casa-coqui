"""
Shared helpers for the CDK stack tests (imported by the test modules).
"""
import json
import os
from pathlib import Path

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Template

INFRA_ROOT = Path(__file__).resolve().parents[1]
TEST_ENV = cdk.Environment(account="123456789012", region="us-east-1")
SNAPSHOT_DIR = Path(__file__).resolve().parent / "__snapshots__"
UPDATE_SNAPSHOTS = os.environ.get("UPDATE_SNAPSHOTS") == "1"


def assert_matches_snapshot(template: Template, name: str) -> None:
    """
    Compare a synthesized template with the committed JSON snapshot.

    Regenerate on purpose with:  UPDATE_SNAPSHOTS=1 python -m pytest tests -q
    A diff here means the CloudFormation output changed — read it like a
    `cdk diff` and commit the new snapshot alongside the stack change.
    """
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    path = SNAPSHOT_DIR / f"{name}.template.json"
    actual = json.dumps(template.to_json(), indent=2, sort_keys=True) + "\n"

    if UPDATE_SNAPSHOTS or not path.exists():
        path.write_text(actual)
        if not UPDATE_SNAPSHOTS:
            pytest.fail(
                f"Snapshot {path.name} did not exist and was written. "
                "Review it, commit it, and re-run."
            )
        return

    expected = path.read_text()
    assert actual == expected, (
        f"Template for {name} drifted from {path.relative_to(INFRA_ROOT)}.\n"
        "If the change is intentional: UPDATE_SNAPSHOTS=1 python -m pytest tests -q"
    )
