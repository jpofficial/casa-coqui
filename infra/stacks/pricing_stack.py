"""
CasaCoquiPricingStack — pricing autopilot infrastructure.

Purpose: keep both units booked at the best sustainable rate by running
the occupancy-aware pricing engine reliably on a schedule. See
docs/superpowers/specs/2026-04-19-pricing-autopilot-codebuild-migration-design.md.

Replaces the Mac mini launchd trigger with CodeBuild + EventBridge Scheduler.
Writes pricing.db snapshots to S3; EC2 systemd timer pulls them.

Resources:
  * S3 bucket casa-coqui-pricing-data (versioned, KMS, RETAIN)
  * CodeBuild project casa-coqui-pricing-autopilot
  * IAM role for CodeBuild
  * CloudWatch log group (3-month retention)
  * EventBridge Scheduler schedule group + two schedules
  * CloudWatch alarm on build FAILED → Foundation SNS topic

Cost: ~$1-3/month. Lifecycle: rebuildable.

Prerequisites:
  * CodeBuild GitHub OAuth connection set up once via AWS console
    (CodeBuild → Build projects → Create project → Source: GitHub →
    "Connect using OAuth"). Account-level, not stack-level — one
    OAuth per account covers all CodeBuild projects.

DOP-C02 exam topics:
  - EventBridge Scheduler vs EventBridge Rules (Scheduler is purpose-built
    for cron-style invocation, 1 target per schedule; Rules are better for
    event-pattern matching, N targets per rule)
  - S3 bucket versioning for recovery (previous-version recovery when a
    run corrupts pricing.db)
  - CloudWatch alarms sourcing from CodeBuild FailedBuilds metric
  - Cross-stack references via Fn.ImportValue (hosting stack imports
    the pricing bucket ARN to grant EC2 read access)
"""
from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_codebuild as codebuild,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cw_actions,
    aws_iam as iam,
    aws_kms as kms,
    aws_logs as logs,
    aws_s3 as s3,
    aws_scheduler as scheduler,
    aws_sns as sns,
)
from constructs import Construct


PRICING_BUCKET_NAME = "casa-coqui-pricing-data"
CODEBUILD_PROJECT_NAME = "casa-coqui-pricing-autopilot"


class CasaCoquiPricingStack(Stack):
    """Pricing autopilot CodeBuild + scheduler + S3 store."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        cmk: kms.IKey,
        notifications_topic: sns.ITopic,
        github_owner: str,
        github_repo: str,
        github_branch: str,
        codeconnection_arn: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 1. S3 bucket — durable pricing.db store
        # ------------------------------------------------------------------
        # Versioned so a corrupted run can be rolled back via
        # `aws s3api copy-object --copy-source ...?versionId=<prev>`.
        # Noncurrent versions expire after 30 days to cap storage cost.
        self.pricing_bucket = s3.Bucket(
            self,
            "PricingDataBucket",
            bucket_name=PRICING_BUCKET_NAME,
            versioned=True,
            enforce_ssl=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.KMS,
            encryption_key=cmk,
            bucket_key_enabled=True,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="expire-noncurrent-versions",
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(30),
                ),
                s3.LifecycleRule(
                    id="expire-run-logs",
                    enabled=True,
                    prefix="runs/",
                    expiration=Duration.days(90),
                ),
            ],
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,  # REQUIRED when removal_policy=RETAIN
        )

        # ------------------------------------------------------------------
        # 2. CloudWatch log group for the CodeBuild project
        # ------------------------------------------------------------------
        # Explicit so retention isn't default-infinite (same cost trap as
        # the email Lambda log group).
        log_group = logs.LogGroup(
            self,
            "PricingAutopilotLogGroup",
            log_group_name=f"/aws/codebuild/{CODEBUILD_PROJECT_NAME}",
            retention=logs.RetentionDays.THREE_MONTHS,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # 3. IAM role for CodeBuild
        # ------------------------------------------------------------------
        codebuild_role = iam.Role(
            self,
            "PricingAutopilotRole",
            assumed_by=iam.ServicePrincipal("codebuild.amazonaws.com"),
            description=(
                "Casa Coqui pricing autopilot CodeBuild role: "
                "S3 R/W on pricing bucket, CloudWatch logs, KMS decrypt"
            ),
        )

        # S3: read + write on the pricing bucket only. grant_read_write
        # also handles the KMS grant for the bucket's encryption key.
        self.pricing_bucket.grant_read_write(codebuild_role)
        cmk.grant_encrypt_decrypt(codebuild_role)

        codebuild_role.add_to_policy(
            iam.PolicyStatement(
                sid="WriteCodeBuildLogs",
                actions=[
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources=[log_group.log_group_arn],
            )
        )

        # Allow CodeBuild to use the existing AWS CodeConnection for GitHub
        # source access. Same connection that CasaCoquiPipelineStack and
        # CasaCoquiEc2PipelineStack use for their pipeline source actions.
        codebuild_role.add_to_policy(
            iam.PolicyStatement(
                sid="UseCodeConnection",
                actions=["codeconnections:UseConnection"],
                resources=[codeconnection_arn],
            )
        )

        # ------------------------------------------------------------------
        # 4. CodeBuild project
        # ------------------------------------------------------------------
        # general1.medium = 7 GB / 4 vCPU. general1.small (3 GB / 2 vCPU)
        # is marginal for Playwright headless Chromium — documented here
        # as an optimization to revisit if cost becomes a concern.
        self.project = codebuild.Project(
            self,
            "PricingAutopilotProject",
            project_name=CODEBUILD_PROJECT_NAME,
            description=(
                "Runs tools/pricing/scripts/autopilot.js on a twice-weekly "
                "schedule. Writes pricing.db snapshot to the pricing bucket."
            ),
            source=codebuild.Source.git_hub(
                owner=github_owner,
                repo=github_repo,
                branch_or_ref=github_branch,
                webhook=False,  # Schedule-triggered only, no on-commit builds.
            ),
            build_spec=codebuild.BuildSpec.from_source_filename(
                "buildspec-pricing.yml"
            ),
            environment=codebuild.BuildEnvironment(
                # Ubuntu 22.04-based image (aws/codebuild/standard:7.0).
                # Playwright officially supports Ubuntu — Amazon Linux
                # does not have apt-get, which Playwright's `install
                # --with-deps` step invokes to pull Chromium's runtime
                # system libraries.
                build_image=codebuild.LinuxBuildImage.STANDARD_7_0,
                compute_type=codebuild.ComputeType.MEDIUM,
                privileged=False,
                environment_variables={
                    "PRICING_BUCKET": codebuild.BuildEnvironmentVariable(
                        value=self.pricing_bucket.bucket_name,
                    ),
                },
            ),
            role=codebuild_role,
            timeout=Duration.minutes(60),
            concurrent_build_limit=1,
            logging=codebuild.LoggingOptions(
                cloud_watch=codebuild.CloudWatchLoggingOptions(
                    enabled=True,
                    log_group=log_group,
                ),
            ),
            # CodeBuild artifacts block uploads to S3 on build success only.
            # On failure, the artifact upload is skipped → last-good
            # pricing.db in S3 is preserved. This is the atomicity
            # guarantee for the reader.
            artifacts=codebuild.Artifacts.s3(
                bucket=self.pricing_bucket,
                include_build_id=False,
                name="pricing.db",
                package_zip=False,
                encryption=True,
            ),
        )

        # L1 escape hatch — override source Auth to use CodeConnections
        # (AWS-managed modern GitHub auth) instead of classic OAuth.
        # codebuild.Source.git_hub() defaults to OAUTH auth, but this
        # account uses CodeConnections (same pattern as pipeline_stack
        # and ec2_pipeline_stack). Wire them together so no separate
        # GitHub PAT or OAuth App install is needed.
        cfn_project = self.project.node.default_child
        cfn_project.add_property_override(
            "Source.Auth.Type", "CODECONNECTIONS"
        )
        cfn_project.add_property_override(
            "Source.Auth.Resource", codeconnection_arn
        )

        # ------------------------------------------------------------------
        # 5. EventBridge Scheduler — twice-weekly triggers
        # ------------------------------------------------------------------
        # EventBridge Scheduler (not EventBridge Rules) because it's the
        # purpose-built cron primitive in AWS: one target per schedule,
        # timezone-aware, with optional flexible windows. Rules are a
        # better fit for event-pattern matching.
        scheduler_role = iam.Role(
            self,
            "PricingSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
            description="EventBridge Scheduler role for pricing autopilot",
        )
        scheduler_role.add_to_policy(
            iam.PolicyStatement(
                sid="StartPricingBuild",
                actions=["codebuild:StartBuild"],
                resources=[self.project.project_arn],
            )
        )

        schedule_group = scheduler.CfnScheduleGroup(
            self,
            "PricingScheduleGroup",
            name="casa-coqui-pricing",
        )

        # Puerto Rico doesn't observe DST (always AST, UTC-4), so we can
        # encode the schedule in UTC without seasonal drift.
        # Mon 06:00 America/Puerto_Rico = Mon 10:00 UTC
        # Thu 18:00 America/Puerto_Rico = Thu 22:00 UTC
        # Miami (where Julio operates) does observe DST, so the local
        # time there drifts by 1 hour twice a year. Accepted — this is
        # internal infra, not user-facing.
        scheduler.CfnSchedule(
            self,
            "PricingMondaySchedule",
            name="casa-coqui-pricing-monday",
            group_name=schedule_group.name,
            schedule_expression="cron(0 10 ? * MON *)",
            schedule_expression_timezone="UTC",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF",
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=self.project.project_arn,
                role_arn=scheduler_role.role_arn,
            ),
            state="ENABLED",
        )

        scheduler.CfnSchedule(
            self,
            "PricingThursdaySchedule",
            name="casa-coqui-pricing-thursday",
            group_name=schedule_group.name,
            schedule_expression="cron(0 22 ? * THU *)",
            schedule_expression_timezone="UTC",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF",
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=self.project.project_arn,
                role_arn=scheduler_role.role_arn,
            ),
            state="ENABLED",
        )

        # ------------------------------------------------------------------
        # 6. CloudWatch alarm on build failure
        # ------------------------------------------------------------------
        # A silent missed run is the failure mode that most directly hurts
        # occupancy — the dashboard keeps showing yesterday's recommendations
        # as if fresh. Alarm ensures Julio hears about it within an hour.
        #
        # CodeBuild publishes a FailedBuilds metric per project. Alarm
        # fires on any failed build in a 1-hour window.
        failure_alarm = cloudwatch.Alarm(
            self,
            "PricingAutopilotFailureAlarm",
            alarm_name="casa-coqui-pricing-autopilot-failed",
            metric=cloudwatch.Metric(
                namespace="AWS/CodeBuild",
                metric_name="FailedBuilds",
                dimensions_map={"ProjectName": self.project.project_name},
                period=Duration.hours(1),
                statistic="Sum",
            ),
            threshold=1,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            alarm_description=(
                "Casa Coqui pricing autopilot build failed. "
                "Check CodeBuild history and runs/<date>/autopilot.log in S3."
            ),
        )
        failure_alarm.add_alarm_action(cw_actions.SnsAction(notifications_topic))

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(
            self,
            "PricingBucketName",
            value=self.pricing_bucket.bucket_name,
            description="S3 bucket holding pricing.db snapshots",
            export_name="CasaCoquiPricing-BucketName",
        )
        CfnOutput(
            self,
            "PricingBucketArn",
            value=self.pricing_bucket.bucket_arn,
            description="ARN of the pricing data bucket (needed by hosting stack)",
            export_name="CasaCoquiPricing-BucketArn",
        )
        CfnOutput(
            self,
            "PricingProjectName",
            value=self.project.project_name,
            description="CodeBuild project name",
            export_name="CasaCoquiPricing-ProjectName",
        )
        CfnOutput(
            self,
            "PricingProjectArn",
            value=self.project.project_arn,
            description="CodeBuild project ARN",
            export_name="CasaCoquiPricing-ProjectArn",
        )
