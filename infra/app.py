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


app = cdk.App()


# ---------------------------------------------------------------------------
# Account-specific identifiers (not committed)
# ---------------------------------------------------------------------------
# Anything that names a specific AWS account — the account id, the GitHub
# CodeConnection ARN, names/ARNs of already-deployed resources — stays out of
# the repo. Each value resolves from CDK context first, then an environment
# variable:
#
#   1. `-c <context-key>=<value>` on the cdk command line, or the same key in
#      an untracked infra/cdk.context.json (copy cdk.context.example.json)
#   2. the environment variable named at each call site below
#
# A missing value fails synth loudly instead of falling back to a placeholder:
# a placeholder default once reset the pipeline's GitHub connection on deploy.
def account_setting(context_key: str, env_var: str, *, example: str) -> str:
    value = app.node.try_get_context(context_key) or os.environ.get(env_var)
    if not value:
        raise SystemExit(
            f"Missing account-specific setting '{context_key}'.\n"
            f"  Pass -c {context_key}=<value>, add it to infra/cdk.context.json "
            f"(see cdk.context.example.json), or export {env_var}.\n"
            f"  Shape: {example}"
        )
    return value


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

# GitHub CodeConnection used by both the Vercel pipeline and the pricing
# autopilot. `aws codebuild list-source-credentials` is the source of truth.
codeconnection_arn = account_setting(
    "codestar_connection_arn",
    "CASA_COQUI_CODECONNECTION_ARN",
    example="arn:aws:codeconnections:us-east-1:<account-id>:connection/<connection-uuid>",
)

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
    codestar_connection_arn=codeconnection_arn,
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
# These three name resources the Foundation stack already created; they are
# looked up by value (not imported) so the Hosting stack stays decoupled.
# Read them off the Foundation stack outputs:
#   aws cloudformation describe-stacks --stack-name CasaCoquiFoundationStack \
#     --query 'Stacks[0].Outputs'
ARTIFACT_BUCKET_NAME = account_setting(
    "casa-coqui:artifact-bucket-name",
    "CASA_COQUI_ARTIFACT_BUCKET_NAME",
    example="casacoquifoundationstack-artifactbucket<hash>-<suffix>",
)
PIPELINE_SECRET_ARN = account_setting(
    "casa-coqui:pipeline-secret-arn",
    "CASA_COQUI_PIPELINE_SECRET_ARN",
    example="arn:aws:secretsmanager:us-east-1:<account-id>:secret:casa-coqui/pipeline-<suffix>",
)
KMS_KEY_ARN = account_setting(
    "casa-coqui:pipeline-cmk-arn",
    "CASA_COQUI_PIPELINE_CMK_ARN",
    example="arn:aws:kms:us-east-1:<account-id>:key/<key-id>",
)

hosting = CasaCoquiHostingStack(
    app,
    "CasaCoquiHostingStack",
    env=env,
    artifact_bucket_name=ARTIFACT_BUCKET_NAME,
    pipeline_secret_arn=PIPELINE_SECRET_ARN,
    cmk_arn=KMS_KEY_ARN,
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
    # consumes) — resolved above from context / env, never committed.
    codeconnection_arn=codeconnection_arn,
    description=(
        "Casa Coqui pricing autopilot — CodeBuild + S3 + EventBridge Scheduler. "
        "Lifecycle: rebuildable."
    ),
)
pricing.add_dependency(foundation)

cdk.Tags.of(app).add("Project", "casa-coqui")
cdk.Tags.of(app).add("ManagedBy", "cdk")
cdk.Tags.of(foundation).add("Lifecycle", "retain")
cdk.Tags.of(pipeline).add("Lifecycle", "rebuildable")
cdk.Tags.of(email).add("Lifecycle", "retain")
cdk.Tags.of(hosting).add("Lifecycle", "rebuildable")
cdk.Tags.of(pricing).add("Lifecycle", "rebuildable")

app.synth()
