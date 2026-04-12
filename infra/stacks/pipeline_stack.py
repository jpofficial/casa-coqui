"""
CasaCoquiPipelineStack — rebuildable CI/CD pipeline.

Resources:
  * CfnParameter for CodeStar connection ARN (falls back to SSM lookup)
  * 2 × CodeBuild PipelineProject (build, deploy) — explicit buildspec files
  * 2 × IAM role (one per project, no sharing)
  * 2 × CloudWatch log group (retention 30 days, DESTROY on teardown)
  * 1 × CodePipeline (classic V2) with 4 stages:
        Source → Build → Approval → Deploy
  * EventBridge rule for pipeline state changes → SNS (Foundation topic)

All resources in this stack use RemovalPolicy.DESTROY so they can be
torn down and recreated independently of the Foundation stack.
"""
from aws_cdk import (
    CfnOutput,
    CfnParameter,
    Duration,
    RemovalPolicy,
    Stack,
    aws_codebuild as codebuild,
    aws_codepipeline as codepipeline,
    aws_codepipeline_actions as cp_actions,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_kms as kms,
    aws_logs as logs,
    aws_s3 as s3,
    aws_secretsmanager as sm,
    aws_sns as sns,
)
from constructs import Construct


PIPELINE_NAME = "casa-coqui-pipeline"
BUILD_PROJECT_NAME = "casa-coqui-build"
DEPLOY_PROJECT_NAME = "casa-coqui-deploy"


class CasaCoquiPipelineStack(Stack):
    """Rebuildable CI/CD pipeline. Destroys cleanly without touching Foundation."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        artifact_bucket: s3.IBucket,
        cmk: kms.IKey,
        pipeline_secret: sm.ISecret,
        notifications_topic: sns.ITopic,
        github_owner: str,
        github_repo: str,
        github_branch: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 1. CfnParameter for the CodeStar connection ARN
        # ------------------------------------------------------------------
        # Raw CfnParameter is intentional exam exposure — the user sees it
        # surfaced in the synthesized template under `Parameters:`.
        codestar_arn_param = CfnParameter(
            self,
            "CodeStarConnectionArn",
            type="String",
            description=(
                "ARN of the GitHub CodeStar connection. Create via Developer "
                "Tools → Settings → Connections. Pass via `cdk deploy -c "
                "codestar_connection_arn=<ARN>` or accept the default lookup."
            ),
            default=self.node.try_get_context("codestar_connection_arn")
            or "arn:aws:codestar-connections:us-east-1:000000000000:connection/00000000-0000-0000-0000-000000000000",
            # AWS renamed the service from codestar-connections to
            # codeconnections in 2024. Accept both so existing consoles
            # and CLI users aren't forced to regenerate their ARN.
            allowed_pattern="^arn:aws:(codestar-connections|codeconnections):[a-z0-9-]+:[0-9]{12}:connection/[a-z0-9-]+$",
            constraint_description="Must be a valid CodeStar Connections ARN",
        )

        # ------------------------------------------------------------------
        # 2. Explicit CloudWatch log groups for CodeBuild
        # ------------------------------------------------------------------
        # Without these, CodeBuild creates log groups with INFINITE retention
        # on first run — D5 cost trap.
        build_log_group = logs.LogGroup(
            self,
            "BuildLogGroup",
            log_group_name=f"/aws/codebuild/{BUILD_PROJECT_NAME}",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )
        deploy_log_group = logs.LogGroup(
            self,
            "DeployLogGroup",
            log_group_name=f"/aws/codebuild/{DEPLOY_PROJECT_NAME}",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # 3. Two IAM roles — no sharing between build and deploy
        # ------------------------------------------------------------------
        build_role = iam.Role(
            self,
            "BuildProjectRole",
            assumed_by=iam.ServicePrincipal("codebuild.amazonaws.com"),
            description="Casa Coqui build project role (read secret, write artifacts, write logs)",
        )
        deploy_role = iam.Role(
            self,
            "DeployProjectRole",
            assumed_by=iam.ServicePrincipal("codebuild.amazonaws.com"),
            description="Casa Coqui deploy project role (read secret, read artifacts, write logs)",
        )

        # Log group writes (same-stack grants are safe — no cycle risk).
        build_log_group.grant_write(build_role)
        deploy_log_group.grant_write(deploy_role)

        # --------------------------------------------------------------
        # Cross-stack permissions — use IDENTITY policies (not grant_*)
        # --------------------------------------------------------------
        # grant_read_write / grant_read / grant_decrypt would cause CDK
        # to emit resource policies on Foundation-stack resources that
        # reference these Pipeline-stack roles, creating a cyclic stack
        # dependency (Foundation → Pipeline and Pipeline → Foundation).
        #
        # Instead, attach explicit PolicyStatements to the roles. The
        # statements reference Foundation resource ARNs by value only,
        # producing a one-way Pipeline → Foundation import. Same runtime
        # permissions, no cycle. DOP-C02 exam surface.

        # Artifact bucket access (read/write for both roles)
        s3_access_policy = iam.PolicyStatement(
            actions=[
                "s3:GetObject*",
                "s3:GetBucket*",
                "s3:List*",
                "s3:DeleteObject*",
                "s3:PutObject*",
                "s3:PutObjectLegalHold",
                "s3:PutObjectRetention",
                "s3:PutObjectTagging",
                "s3:PutObjectVersionTagging",
                "s3:Abort*",
            ],
            resources=[
                artifact_bucket.bucket_arn,
                f"{artifact_bucket.bucket_arn}/*",
            ],
        )
        build_role.add_to_policy(s3_access_policy)
        deploy_role.add_to_policy(s3_access_policy)

        # Secret read access. The trailing "-*" covers the 6-char random
        # suffix Secrets Manager appends to every secret ARN at runtime.
        secret_read_policy = iam.PolicyStatement(
            actions=[
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
            ],
            resources=[
                pipeline_secret.secret_arn,
                f"{pipeline_secret.secret_arn}-*",
            ],
        )
        build_role.add_to_policy(secret_read_policy)
        deploy_role.add_to_policy(secret_read_policy)

        # KMS — encrypt/decrypt for the secret + artifact bucket.
        kms_access_policy = iam.PolicyStatement(
            actions=[
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:GenerateDataKey*",
                "kms:ReEncrypt*",
            ],
            resources=[cmk.key_arn],
        )
        build_role.add_to_policy(kms_access_policy)
        deploy_role.add_to_policy(kms_access_policy)

        # SSM read — buildspec reads NEXT_PUBLIC_APP_URL from parameter-store.
        # Scoped narrowly to just the casa-coqui pipeline namespace.
        ssm_read_policy = iam.PolicyStatement(
            actions=[
                "ssm:GetParameters",
                "ssm:GetParameter",
            ],
            resources=[
                f"arn:aws:ssm:{self.region}:{self.account}:parameter/casa-coqui/pipeline/*",
            ],
        )
        build_role.add_to_policy(ssm_read_policy)
        deploy_role.add_to_policy(ssm_read_policy)

        # CodeBuild report-group perms (empty for now, Phase 2 reuses this block)
        build_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "codebuild:CreateReportGroup",
                    "codebuild:CreateReport",
                    "codebuild:UpdateReport",
                    "codebuild:BatchPutTestCases",
                    "codebuild:BatchPutCodeCoverages",
                ],
                resources=[
                    f"arn:aws:codebuild:{self.region}:{self.account}:report-group/{BUILD_PROJECT_NAME}-*",
                ],
            )
        )

        # ------------------------------------------------------------------
        # 4. CodeBuild projects
        # ------------------------------------------------------------------
        build_environment = codebuild.BuildEnvironment(
            build_image=codebuild.LinuxBuildImage.STANDARD_7_0,
            compute_type=codebuild.ComputeType.SMALL,
            privileged=False,
        )

        build_logging = codebuild.LoggingOptions(
            cloud_watch=codebuild.CloudWatchLoggingOptions(
                log_group=build_log_group,
                enabled=True,
            )
        )
        deploy_logging = codebuild.LoggingOptions(
            cloud_watch=codebuild.CloudWatchLoggingOptions(
                log_group=deploy_log_group,
                enabled=True,
            )
        )

        build_project = codebuild.PipelineProject(
            self,
            "BuildProject",
            project_name=BUILD_PROJECT_NAME,
            description="Casa Coqui — lint + next build, emits deploy artifact",
            build_spec=codebuild.BuildSpec.from_source_filename("buildspec-build.yml"),
            environment=build_environment,
            role=build_role,
            encryption_key=cmk,
            cache=codebuild.Cache.local(
                codebuild.LocalCacheMode.CUSTOM,
                codebuild.LocalCacheMode.SOURCE,
            ),
            logging=build_logging,
            timeout=Duration.minutes(30),
            queued_timeout=Duration.hours(1),
        )
        # NOTE: `BadgeEnabled=True` is intentionally NOT set on this project.
        # CodeBuild build badges only work when the project's `Source.Type` is
        # GITHUB / BITBUCKET / GITHUB_ENTERPRISE. `PipelineProject` uses
        # `CODEPIPELINE` as its source type, so CloudFormation rejects
        # BadgeEnabled here. A public green-status badge for Casa Coqui would
        # require a second, GitHub-sourced CodeBuild project — deferred to
        # Phase 2 (PR validation pipeline).

        deploy_project = codebuild.PipelineProject(
            self,
            "DeployProject",
            project_name=DEPLOY_PROJECT_NAME,
            description="Casa Coqui — vercel deploy + firebase deploy",
            build_spec=codebuild.BuildSpec.from_source_filename("buildspec-deploy.yml"),
            environment=build_environment,
            role=deploy_role,
            encryption_key=cmk,
            cache=codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
            logging=deploy_logging,
            timeout=Duration.minutes(20),
            queued_timeout=Duration.hours(1),
        )

        # ------------------------------------------------------------------
        # 5. Pipeline (classic CodePipeline, V2 pipeline type)
        # ------------------------------------------------------------------
        source_artifact = codepipeline.Artifact("SourceArtifact")
        build_artifact = codepipeline.Artifact("BuildArtifact")

        source_action = cp_actions.CodeStarConnectionsSourceAction(
            action_name="Source_GitHub",
            owner=github_owner,
            repo=github_repo,
            branch=github_branch,
            connection_arn=codestar_arn_param.value_as_string,
            output=source_artifact,
            trigger_on_push=True,
            code_build_clone_output=False,
            run_order=1,
        )

        build_action = cp_actions.CodeBuildAction(
            action_name="Build_Next",
            project=build_project,
            input=source_artifact,
            outputs=[build_artifact],
            run_order=1,
        )

        # CDK's ManualApprovalAction auto-creates a role with sns:Publish
        # but NOT kms permissions. When the SNS topic is CMK-encrypted,
        # the publish fails with "pipeline or action role does not have
        # access to the encryption key." (This is Trap 4 from README.)
        #
        # Fix: create an explicit role with both sns:Publish AND KMS
        # permissions, and pass it to the approval action.
        approval_role = iam.Role(
            self,
            "ApprovalActionRole",
            assumed_by=iam.CompositePrincipal(
                iam.ServicePrincipal("codepipeline.amazonaws.com"),
                iam.AccountPrincipal(self.account),
            ),
            description="Casa Coqui approval action role (SNS publish + KMS for encrypted topic)",
        )
        approval_role.add_to_policy(iam.PolicyStatement(
            actions=["sns:Publish"],
            resources=[notifications_topic.topic_arn],
        ))
        approval_role.add_to_policy(iam.PolicyStatement(
            actions=["kms:GenerateDataKey*", "kms:Decrypt", "kms:DescribeKey"],
            resources=[cmk.key_arn],
        ))

        approval_action = cp_actions.ManualApprovalAction(
            action_name="Approve_Deploy",
            notification_topic=notifications_topic,
            role=approval_role,
            additional_information=(
                "Approve to deploy Casa Coqui to Vercel (production) and "
                "Firebase (functions + firestore rules + indexes). "
                "Cancel if the Build stage output looks suspicious."
            ),
            run_order=1,
        )

        deploy_action = cp_actions.CodeBuildAction(
            action_name="Deploy_VercelAndFirebase",
            project=deploy_project,
            input=build_artifact,
            run_order=1,
        )

        pipeline = codepipeline.Pipeline(
            self,
            "Pipeline",
            pipeline_name=PIPELINE_NAME,
            pipeline_type=codepipeline.PipelineType.V2,
            artifact_bucket=artifact_bucket,
            restart_execution_on_update=False,
            cross_account_keys=False,
            stages=[
                codepipeline.StageProps(
                    stage_name="Source",
                    actions=[source_action],
                ),
                codepipeline.StageProps(
                    stage_name="Build",
                    actions=[build_action],
                ),
                codepipeline.StageProps(
                    stage_name="Approval",
                    actions=[approval_action],
                ),
                codepipeline.StageProps(
                    stage_name="Deploy",
                    actions=[deploy_action],
                ),
            ],
        )
        pipeline.apply_removal_policy(RemovalPolicy.DESTROY)

        # ------------------------------------------------------------------
        # 6. EventBridge rule — pipeline state changes → SNS
        # ------------------------------------------------------------------
        # Catch failures and successes at the pipeline + stage level and
        # publish them to the Foundation SNS topic so they reach the
        # notification email.
        events.Rule(
            self,
            "PipelineStateChangeRule",
            rule_name="casa-coqui-pipeline-state-changes",
            description="Forward Casa Coqui pipeline state changes to SNS",
            event_pattern=events.EventPattern(
                source=["aws.codepipeline"],
                detail_type=[
                    "CodePipeline Pipeline Execution State Change",
                    "CodePipeline Stage Execution State Change",
                    "CodePipeline Action Execution State Change",
                ],
                detail={
                    "pipeline": [PIPELINE_NAME],
                    "state": ["FAILED", "SUCCEEDED", "CANCELED", "STOPPED"],
                },
            ),
            targets=[events_targets.SnsTopic(notifications_topic)],
        )

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(
            self,
            "PipelineArn",
            value=pipeline.pipeline_arn,
            description="Casa Coqui CodePipeline ARN",
        )
        CfnOutput(
            self,
            "PipelineConsoleUrl",
            value=(
                f"https://{self.region}.console.aws.amazon.com/codesuite/"
                f"codepipeline/pipelines/{PIPELINE_NAME}/view?region={self.region}"
            ),
            description="AWS Console link to the Casa Coqui pipeline",
        )
        CfnOutput(
            self,
            "BuildProjectArn",
            value=build_project.project_arn,
            description="CodeBuild build project ARN",
        )
        CfnOutput(
            self,
            "BuildProjectName",
            value=build_project.project_name,
            description="CodeBuild build project name",
        )
        CfnOutput(
            self,
            "DeployProjectName",
            value=deploy_project.project_name,
            description="CodeBuild deploy project name",
        )
