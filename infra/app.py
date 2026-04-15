#!/usr/bin/env python3
"""
Casa Coqui CDK entrypoint.

Instantiates three stacks:
  1. CasaCoquiFoundationStack — long-lived resources (KMS, S3, Secret, SNS)
  2. CasaCoquiPipelineStack   — rebuildable CI/CD pipeline
  3. CasaCoquiEmailStack      — inbound email infrastructure (SES, S3, Lambda)

Foundation constructs are passed directly into the Pipeline stack constructor
so CDK synthesizes cross-stack Exports automatically. This gives the
exam-relevant "cannot delete Foundation while Pipeline imports it" behavior
for free.
"""
import os

import aws_cdk as cdk

from stacks.foundation_stack import CasaCoquiFoundationStack
from stacks.pipeline_stack import CasaCoquiPipelineStack
from stacks.email_stack import CasaCoquiEmailStack


app = cdk.App()

env = cdk.Environment(
    account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
    region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
)

# Notification email resolves from CDK context:
#   cdk deploy -c casa-coqui:notification-email=you@example.com
# Falls back to the default set in cdk.json.
notification_email = app.node.try_get_context("casa-coqui:notification-email")
if not notification_email:
    raise SystemExit(
        "Missing context key 'casa-coqui:notification-email'. "
        "Set it in cdk.json or pass -c casa-coqui:notification-email=you@example.com"
    )

github_owner = app.node.try_get_context("casa-coqui:github-owner") or "jpofficial"
github_repo = app.node.try_get_context("casa-coqui:github-repo") or "casa-coqui"
github_branch = app.node.try_get_context("casa-coqui:github-branch") or "main"

# Foundation first — its constructs become inputs to the Pipeline stack.
foundation = CasaCoquiFoundationStack(
    app,
    "CasaCoquiFoundationStack",
    env=env,
    notification_email=notification_email,
    description="Casa Coqui CI/CD foundation — KMS, S3, Secret, SNS. Lifecycle: retain.",
)

pipeline = CasaCoquiPipelineStack(
    app,
    "CasaCoquiPipelineStack",
    env=env,
    artifact_bucket=foundation.artifact_bucket,
    cmk=foundation.cmk,
    pipeline_secret=foundation.pipeline_secret,
    notifications_topic=foundation.notifications_topic,
    github_owner=github_owner,
    github_repo=github_repo,
    github_branch=github_branch,
    description="Casa Coqui CI/CD pipeline — CodeBuild + CodePipeline. Lifecycle: rebuildable.",
)

# Email stack — SES inbound, S3 raw storage, Lambda parser.
# Depends on Foundation so `cdk deploy --all` orders correctly and so the
# Foundation stack cannot be destroyed while Email exists.
email = CasaCoquiEmailStack(
    app,
    "CasaCoquiEmailStack",
    env=env,
    description=(
        "Casa Coqui inbound email pipeline — SES, S3, Lambda. "
        "Receives Airbnb receipts and parses them into Firestore."
    ),
)

# Make the dependency explicit so `cdk deploy --all` orders correctly and
# so `cdk destroy CasaCoquiFoundationStack` fails loudly while Pipeline exists.
pipeline.add_dependency(foundation)

# Email stack depends on Foundation for consistent deploy ordering.
# No resource references cross the boundary today; the dependency is
# logical (Foundation provisions the account baseline first).
email.add_dependency(foundation)

cdk.Tags.of(app).add("Project", "casa-coqui")
cdk.Tags.of(app).add("ManagedBy", "cdk")
cdk.Tags.of(foundation).add("Lifecycle", "retain")
cdk.Tags.of(pipeline).add("Lifecycle", "rebuildable")
cdk.Tags.of(email).add("Lifecycle", "retain")

app.synth()
