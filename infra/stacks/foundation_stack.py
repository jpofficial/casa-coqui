"""
CasaCoquiFoundationStack — long-lived CI/CD foundation.

Resources:
  * KMS CMK (rotation on, RETAIN)
  * S3 artifact bucket (versioned, KMS-encrypted, 30d lifecycle, RETAIN)
  * Secrets Manager secret `casa-coqui/pipeline` (one JSON blob, RETAIN)
  * SNS topic `casa-coqui-pipeline-events` (KMS-encrypted, DELETE)
  * Email subscription on SNS topic
  * SSM StringParameter for CodeStar connection ARN
  * CloudWatch log group for Secrets Manager access audit

DeletionPolicy layout is intentional — used as an exam exposure surface:
  Bucket=RETAIN, CMK=RETAIN, Secret=RETAIN, SNS=DELETE, LogGroup=DELETE.
"""
import json

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_iam as iam,
    aws_kms as kms,
    aws_logs as logs,
    aws_s3 as s3,
    aws_secretsmanager as sm,
    aws_sns as sns,
    aws_sns_subscriptions as sns_subs,
    aws_ssm as ssm,
)
from constructs import Construct


class CasaCoquiFoundationStack(Stack):
    """Create-once, never-delete foundation for the Casa Coqui pipeline."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        notification_email: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 1. Customer Managed KMS key
        # ------------------------------------------------------------------
        # Rotation on by design (DevOps exam D6 — audit/security).
        # RETAIN with the standard pending-deletion window (7-30 days) —
        # scheduled deletion trap exposure.
        self.cmk = kms.Key(
            self,
            "PipelineCmk",
            alias="alias/casa-coqui/pipeline",
            description="Customer managed key for Casa Coqui CI/CD (S3 artifacts, Secret, SNS)",
            enable_key_rotation=True,
            pending_window=Duration.days(7),
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Explicit grants for AWS service principals that need to use the CMK.
        # Without these, email delivery on a KMS-encrypted SNS topic silently
        # fails and the S3 bucket rejects writes from CodePipeline.
        self.cmk.grant_encrypt_decrypt(iam.ServicePrincipal("sns.amazonaws.com"))
        self.cmk.grant_encrypt_decrypt(
            iam.ServicePrincipal("events.amazonaws.com")
        )
        self.cmk.grant_encrypt_decrypt(
            iam.ServicePrincipal("codepipeline.amazonaws.com")
        )
        self.cmk.grant_encrypt_decrypt(
            iam.ServicePrincipal("codebuild.amazonaws.com")
        )
        # CloudWatch Logs needs a region-scoped service principal to encrypt
        # log streams with a CMK. This is required for the Secrets Manager
        # audit log group (and any log group that passes encryption_key).
        self.cmk.grant_encrypt_decrypt(
            iam.ServicePrincipal(f"logs.{self.region}.amazonaws.com")
        )

        # ------------------------------------------------------------------
        # 2. S3 artifact bucket
        # ------------------------------------------------------------------
        self.artifact_bucket = s3.Bucket(
            self,
            "ArtifactBucket",
            bucket_name=None,  # let CDK pick a unique name
            encryption=s3.BucketEncryption.KMS,
            encryption_key=self.cmk,
            bucket_key_enabled=True,
            versioned=True,
            enforce_ssl=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="expire-old-artifacts",
                    enabled=True,
                    expiration=Duration.days(30),
                    noncurrent_version_expiration=Duration.days(30),
                    abort_incomplete_multipart_upload_after=Duration.days(1),
                ),
            ],
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,  # REQUIRED when removal_policy=RETAIN
        )

        # ------------------------------------------------------------------
        # 3. Secrets Manager — one JSON secret, many keys
        # ------------------------------------------------------------------
        # Single secret with a placeholder JSON body. Real values get written
        # out-of-band during bootstrap via:
        #   aws secretsmanager put-secret-value \
        #     --secret-id casa-coqui/pipeline \
        #     --secret-string file:///tmp/secret.json
        #
        # Individual buildspec steps reference keys via:
        #   env:
        #     secrets-manager:
        #       FIREBASE_SERVICE_ACCOUNT_KEY: casa-coqui/pipeline:FIREBASE_SERVICE_ACCOUNT_KEY
        placeholder_body = {
            "NEXT_PUBLIC_FIREBASE_API_KEY": "replace-me",
            "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN": "replace-me",
            "NEXT_PUBLIC_FIREBASE_PROJECT_ID": "replace-me",
            "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET": "replace-me",
            "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": "replace-me",
            "NEXT_PUBLIC_FIREBASE_APP_ID": "replace-me",
            "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID": "replace-me",
            "NEXT_PUBLIC_FIREBASE_VAPID_KEY": "replace-me",
            "NEXT_PUBLIC_ADMIN_EMAIL": "replace-me",
            "FIREBASE_SERVICE_ACCOUNT_KEY": "replace-me",
            "RESEND_API_KEY": "replace-me",
            "ANTHROPIC_API_KEY": "replace-me",
            "VERCEL_TOKEN": "replace-me",
            "VERCEL_ORG_ID": "replace-me",
            "VERCEL_PROJECT_ID": "replace-me",
        }

        self.pipeline_secret = sm.Secret(
            self,
            "PipelineSecret",
            secret_name="casa-coqui/pipeline",
            description="Casa Coqui CI/CD pipeline secrets (one JSON blob, key-scoped refs)",
            encryption_key=self.cmk,
            generate_secret_string=sm.SecretStringGenerator(
                secret_string_template=json.dumps(placeholder_body),
                generate_string_key="_placeholder",
                exclude_punctuation=True,
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ------------------------------------------------------------------
        # 4. SNS topic + email subscription
        # ------------------------------------------------------------------
        self.notifications_topic = sns.Topic(
            self,
            "PipelineNotificationsTopic",
            topic_name="casa-coqui-pipeline-events",
            display_name="Casa Coqui Pipeline",
            master_key=self.cmk,
        )
        # SNS topic is DELETE — it's a communication channel, recreating
        # forces re-confirmation of the email subscription anyway.
        self.notifications_topic.apply_removal_policy(RemovalPolicy.DESTROY)

        self.notifications_topic.add_subscription(
            sns_subs.EmailSubscription(notification_email)
        )

        # ------------------------------------------------------------------
        # 5. SSM parameter for the CodeStar connection ARN
        # ------------------------------------------------------------------
        # Value is a sentinel on first deploy. The actual ARN is written
        # out-of-band via `aws ssm put-parameter --overwrite`.
        self.codestar_connection_param = ssm.StringParameter(
            self,
            "CodeStarConnectionArnParam",
            parameter_name="/casa-coqui/pipeline/codestar-connection-arn",
            string_value="PLACEHOLDER_SET_VIA_AWS_SSM_PUT_PARAMETER",
            description="ARN of the GitHub CodeStar connection used by the Casa Coqui pipeline",
            tier=ssm.ParameterTier.STANDARD,
        )
        self.codestar_connection_param.apply_removal_policy(RemovalPolicy.RETAIN)

        # ------------------------------------------------------------------
        # 6. Secrets Manager access audit log group
        # ------------------------------------------------------------------
        # Explicit so retention is not default-infinite (cost trap, D5).
        self.secrets_audit_log_group = logs.LogGroup(
            self,
            "SecretsAuditLogGroup",
            log_group_name="/aws/secretsmanager/casa-coqui-pipeline-access",
            retention=logs.RetentionDays.THREE_MONTHS,
            encryption_key=self.cmk,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # Outputs — named Exports so Pipeline stack can rebuild independently.
        # ------------------------------------------------------------------
        CfnOutput(
            self,
            "ArtifactBucketName",
            value=self.artifact_bucket.bucket_name,
            description="S3 artifact bucket for CodePipeline",
            export_name="CasaCoquiFoundation-ArtifactBucketName",
        )
        CfnOutput(
            self,
            "CmkArn",
            value=self.cmk.key_arn,
            description="Customer managed KMS key ARN",
            export_name="CasaCoquiFoundation-CmkArn",
        )
        CfnOutput(
            self,
            "PipelineSecretArn",
            value=self.pipeline_secret.secret_arn,
            description="Secrets Manager ARN for pipeline secret",
            export_name="CasaCoquiFoundation-PipelineSecretArn",
        )
        CfnOutput(
            self,
            "NotificationsTopicArn",
            value=self.notifications_topic.topic_arn,
            description="SNS topic ARN for pipeline notifications + manual approval",
            export_name="CasaCoquiFoundation-NotificationsTopicArn",
        )
        CfnOutput(
            self,
            "CodeStarConnectionParamName",
            value=self.codestar_connection_param.parameter_name,
            description="SSM param name holding the CodeStar connection ARN",
            export_name="CasaCoquiFoundation-CodeStarConnectionParamName",
        )
