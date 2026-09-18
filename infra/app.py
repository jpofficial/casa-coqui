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
from stacks.hosting_stack import CasaCoquiHostingStack
from stacks.pricing_stack import CasaCoquiPricingStack
from stacks.itinerary_stack import MiItinerarioStack


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

# ------------------------------------------------------------------
# EC2 Hosting stack — EC2, ALB, CodeDeploy (already deployed).
# ------------------------------------------------------------------
ARTIFACT_BUCKET_NAME = "casacoquifoundationstack-artifactbucket7410c9ef-dylmy0p5mscz"
PIPELINE_SECRET_ARN = (
    "arn:aws:secretsmanager:us-east-1:524140443248"
    ":secret:casa-coqui/pipeline-FNJvCt"
)
KMS_KEY_ARN = "arn:aws:kms:us-east-1:524140443248:key/3c534568-f0e6-4d38-b581-d862604669cb"

hosting = CasaCoquiHostingStack(
    app,
    "CasaCoquiHostingStack",
    env=env,
    artifact_bucket_name=ARTIFACT_BUCKET_NAME,
    pipeline_secret_arn=PIPELINE_SECRET_ARN,
    description=(
        "Casa Coqui EC2 hosting - ALB, CodeDeploy, Route53. "
        "DOP-C02 exam practice."
    ),
)

# EC2 Pipeline stack — REMOVED 2026-05-09 to stop CodeBuild/CodePipeline
# free-tier overage. The `ec2-deploy` branch is no longer the production
# source; main is. The stack code was retired from the repo in 2026-09; the
# design is preserved in docs/superpowers/specs/2026-04-18-codepipeline-ec2-deploy-design.md.

# ------------------------------------------------------------------
# Pricing stack — autopilot CodeBuild + S3 + EventBridge Scheduler.
# Replaces the Mac mini launchd runner so fill-rate recommendations
# reach the dashboard on a reliable schedule. See
# docs/superpowers/specs/2026-04-19-pricing-autopilot-codebuild-migration-design.md.
# ------------------------------------------------------------------
pricing = CasaCoquiPricingStack(
    app,
    "CasaCoquiPricingStack",
    env=env,
    cmk=foundation.cmk,
    notifications_topic=foundation.notifications_topic,
    github_owner=github_owner,
    github_repo=github_repo,
    # Pricing autopilot builds from main — the canonical branch with all
    # pricing fixes. The legacy ec2-deploy branch was the merge source
    # during the EC2 migration and has been folded back into main; tracking
    # main keeps the autopilot JS (decision engine, scrapers) in sync with
    # the live state. Manual builds with --source-version main were the
    # only thing keeping production current before this change.
    github_branch="main",
    # Reuses the existing AWS CodeConnection (same one pipeline_stack
    # consumes). `aws codebuild list-source-credentials`
    # is the source of truth for this ARN.
    codeconnection_arn=(
        "arn:aws:codeconnections:us-east-1:524140443248"
        ":connection/beb59a0a-315f-4a9b-b179-4d8fa4c7a1c5"
    ),
    description=(
        "Casa Coqui pricing autopilot — CodeBuild + S3 + EventBridge Scheduler. "
        "Lifecycle: rebuildable."
    ),
)
pricing.add_dependency(foundation)

itinerary = MiItinerarioStack(app, "MiItinerarioStack", env=env)

cdk.Tags.of(app).add("Project", "casa-coqui")
cdk.Tags.of(app).add("ManagedBy", "cdk")
cdk.Tags.of(foundation).add("Lifecycle", "retain")
cdk.Tags.of(pipeline).add("Lifecycle", "rebuildable")
cdk.Tags.of(email).add("Lifecycle", "retain")
cdk.Tags.of(hosting).add("Lifecycle", "rebuildable")
cdk.Tags.of(pricing).add("Lifecycle", "rebuildable")
cdk.Tags.of(itinerary).add("Lifecycle", "rebuildable")

app.synth()
