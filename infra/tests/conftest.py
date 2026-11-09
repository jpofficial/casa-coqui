"""
Shared pytest fixtures for the CDK stack tests.

Run from the `infra/` directory (the CDK app root):

    cd infra
    python -m pytest tests -q

or from the repo root via `npm run test:infra`.

The stacks are synthesized in-process with a fixed, obviously fake account and
region (see tests/helpers.py) so templates are deterministic and the tests
never touch AWS.
"""
import sys
from pathlib import Path

import pytest

INFRA_ROOT = Path(__file__).resolve().parents[1]
if str(INFRA_ROOT) not in sys.path:
    sys.path.insert(0, str(INFRA_ROOT))

import aws_cdk as cdk  # noqa: E402  (after sys.path tweak)


@pytest.fixture
def app() -> cdk.App:
    # No cdk.json context here: tests must not depend on the operator's local
    # context (account-specific ARNs, lookups cached in cdk.context.json).
    return cdk.App()
