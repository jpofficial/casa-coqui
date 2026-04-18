"""
CasaCoquiEc2PipelineStack — CodePipeline for EC2 deployment.

Pulls from the ec2-deploy branch, builds in CodeBuild, deploys to EC2
via CodeDeploy. Separate from the Vercel pipeline (pipeline_stack.py).

Resources:
  * 1 x CodeBuild PipelineProject (build only — no deploy project needed)
  * 1 x IAM role for CodeBuild
  * 1 x CloudWatch log group (retention 30 days, DESTROY)
  * 1 x CodePipeline (V2) with 3 stages: Source -> Build -> Deploy
  * CfnParameter for CodeStar connection ARN

DOP-C02 exam topics:
  - CodePipeline V2 (event-driven, not polling)
  - CodeBuild buildspec.yml (phases, artifacts, secrets-manager env)
  - CodeDeploy as a pipeline deploy action (not CodeBuild-driven)
  - CodeStar Connections for GitHub source
  - Cross-stack references (hosting stack resources referenced by name/ARN)
  - Separation of build and deploy concerns

All resources use RemovalPolicy.DESTROY — this stack can be torn down
without affecting the hosting stack or Foundation stack.
"""
from aws_cdk import (
    CfnOutput,
    CfnParameter,
    Duration,
    RemovalPolicy,
    Stack,
    aws_codebuild as codebuild,
    aws_codedeploy as codedeploy,
    aws_codepipeline as codepipeline,
    aws_codepipeline_actions as cp_actions,
    aws_iam as iam,
    aws_logs as logs,
    aws_s3 as s3,
)
from constructs import Construct


EC2_PIPELINE_NAME = "casa-coqui-ec2-pipeline"
EC2_BUILD_PROJECT_NAME = "casa-coqui-ec2-build"


class CasaCoquiEc2PipelineStack(Stack):
    """CodePipeline: GitHub → CodeBuild → CodeDeploy to EC2."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        artifact_bucket_name: str,
        pipeline_secret_arn: str,
        kms_key_arn: str,
        github_owner: str = "jpofficial",
        github_repo: str = "casa-coqui",
        github_branch: str = "ec2-deploy",
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 0. Look up existing resources by name/ARN
        # ------------------------------------------------------------------
        # DOP-C02 exam note: We reference Foundation stack resources by
        # name/ARN rather than passing constructs. This avoids cross-stack
        # coupling — the EC2 pipeline stack can be destroyed independently.
        artifact_bucket = s3.Bucket.from_bucket_name(
            self, "ArtifactBucket", artifact_bucket_name
        )

        # ------------------------------------------------------------------
        # 1. CfnParameter for CodeStar connection ARN
        # ------------------------------------------------------------------
        codestar_arn_param = CfnParameter(
            self,
            "CodeStarConnectionArn",
            type="String",
            description="ARN of the GitHub CodeStar connection",
            default=self.node.try_get_context("codestar_connection_arn")
            or "arn:aws:codeconnections:us-east-1:524140443248:connection/beb59a0a-315f-4a9b-b179-4d8fa4c7a1c5",
            allowed_pattern="^arn:aws:(codestar-connections|codeconnections):[a-z0-9-]+:[0-9]{12}:connection/[a-z0-9-]+$",
            constraint_description="Must be a valid CodeStar/CodeConnections ARN",
        )

        # ------------------------------------------------------------------
        # 2. CloudWatch log group for CodeBuild
        # ------------------------------------------------------------------
        # DOP-C02 exam note: Without explicit log groups, CodeBuild creates
        # them with INFINITE retention — a cost trap on the exam.
        build_log_group = logs.LogGroup(
            self,
            "Ec2BuildLogGroup",
            log_group_name=f"/aws/codebuild/{EC2_BUILD_PROJECT_NAME}",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # 3. IAM role for CodeBuild
        # ------------------------------------------------------------------
        build_role = iam.Role(
            self,
            "Ec2BuildRole",
            assumed_by=iam.ServicePrincipal("codebuild.amazonaws.com"),
            description="Casa Coqui EC2 build role - read secrets, write artifacts, write logs",
        )

        build_log_group.grant_write(build_role)

        # S3 artifact bucket — read source, write build output
        build_role.add_to_policy(iam.PolicyStatement(
            actions=[
                "s3:GetObject*",
                "s3:GetBucket*",
                "s3:List*",
                "s3:PutObject*",
                "s3:Abort*",
            ],
            resources=[
                artifact_bucket.bucket_arn,
                f"{artifact_bucket.bucket_arn}/*",
            ],
        ))

        # Secrets Manager — buildspec pulls NEXT_PUBLIC_* vars at build time
        # DOP-C02 exam note: The trailing "-*" covers the random suffix
        # that Secrets Manager appends to every secret ARN.
        build_role.add_to_policy(iam.PolicyStatement(
            actions=["secretsmanager:GetSecretValue"],
            resources=[
                pipeline_secret_arn,
                f"{pipeline_secret_arn}-*",
            ],
        ))

        # KMS — decrypt secrets and artifact bucket objects
        build_role.add_to_policy(iam.PolicyStatement(
            actions=[
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:GenerateDataKey*",
                "kms:ReEncrypt*",
            ],
            resources=[kms_key_arn],
        ))

        # ------------------------------------------------------------------
        # 4. CodeBuild project
        # ------------------------------------------------------------------
        # DOP-C02 exam note: STANDARD_7_0 is the latest Amazon Linux 2023
        # build image. SMALL compute type (3GB RAM, 2 vCPU) is free tier
        # eligible — 100 build-min/month.
        build_project = codebuild.PipelineProject(
            self,
            "Ec2BuildProject",
            project_name=EC2_BUILD_PROJECT_NAME,
            description="Casa Coqui EC2 - npm ci + next build, outputs pre-built artifact",
            build_spec=codebuild.BuildSpec.from_source_filename("buildspec.yml"),
            environment=codebuild.BuildEnvironment(
                build_image=codebuild.LinuxBuildImage.STANDARD_7_0,
                compute_type=codebuild.ComputeType.SMALL,
                privileged=False,
            ),
            role=build_role,
            cache=codebuild.Cache.local(
                codebuild.LocalCacheMode.CUSTOM,
                codebuild.LocalCacheMode.SOURCE,
            ),
            logging=codebuild.LoggingOptions(
                cloud_watch=codebuild.CloudWatchLoggingOptions(
                    log_group=build_log_group,
                    enabled=True,
                ),
            ),
            timeout=Duration.minutes(15),
            queued_timeout=Duration.hours(1),
        )

        # ------------------------------------------------------------------
        # 5. Look up existing CodeDeploy application + deployment group
        # ------------------------------------------------------------------
        # DOP-C02 exam note: We reference the CodeDeploy resources created
        # by the Hosting stack. CodePipeline's CodeDeployServerDeployAction
        # needs the application name and deployment group name.
        codedeploy_app = codedeploy.ServerApplication.from_server_application_name(
            self, "CodeDeployApp", "casa-coqui"
        )
        deployment_group = codedeploy.ServerDeploymentGroup.from_server_deployment_group_attributes(
            self, "DeploymentGroup",
            application=codedeploy_app,
            deployment_group_name="casa-coqui-production",
        )

        # ------------------------------------------------------------------
        # 6. CodePipeline — Source → Build → Deploy
        # ------------------------------------------------------------------
        # DOP-C02 exam note: This is the standard 3-stage pipeline for
        # EC2 deployments. No approval stage for exam practice (fast
        # iteration). Production would add an Approval stage between
        # Build and Deploy.
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
            action_name="Build_NextJs",
            project=build_project,
            input=source_artifact,
            outputs=[build_artifact],
            run_order=1,
        )

        # DOP-C02 exam note: CodeDeployServerDeployAction is the pipeline
        # action that triggers an EC2 in-place deployment. It passes the
        # build artifact (zip) to CodeDeploy, which downloads it to the
        # EC2 instance and runs the appspec.yml lifecycle hooks.
        deploy_action = cp_actions.CodeDeployServerDeployAction(
            action_name="Deploy_EC2",
            deployment_group=deployment_group,
            input=build_artifact,
            run_order=1,
        )

        pipeline = codepipeline.Pipeline(
            self,
            "Ec2Pipeline",
            pipeline_name=EC2_PIPELINE_NAME,
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
                    stage_name="Deploy",
                    actions=[deploy_action],
                ),
            ],
        )
        pipeline.apply_removal_policy(RemovalPolicy.DESTROY)

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(
            self, "Ec2PipelineArn",
            value=pipeline.pipeline_arn,
            description="EC2 CodePipeline ARN",
        )
        CfnOutput(
            self, "Ec2PipelineConsoleUrl",
            value=(
                f"https://{self.region}.console.aws.amazon.com/codesuite/"
                f"codepipeline/pipelines/{EC2_PIPELINE_NAME}/view?region={self.region}"
            ),
            description="AWS Console link to the EC2 pipeline",
        )
        CfnOutput(
            self, "Ec2BuildProjectName",
            value=build_project.project_name,
            description="CodeBuild project name for EC2 builds",
        )
