"""
CasaCoquiEmailStack — inbound email infrastructure for receipt parsing.

Resources:
  * Route53 hosted zone lookup for `casa-coqui.cc` (existing, not created here)
  * MX record on `inbox.casa-coqui.cc` → SES inbound SMTP endpoint
  * SES EmailIdentity for `inbox.casa-coqui.cc` with auto-DKIM (3 CNAMEs)
  * TXT SPF record on `inbox.casa-coqui.cc`
  * S3 bucket `casa-coqui-inbound-email` (90-day lifecycle, RETAIN)
  * Lambda function to parse Airbnb confirmation emails from S3
  * SES ReceiptRuleSet + ReceiptRule: save to S3, invoke Lambda
  * IAM role for Lambda: S3 read, Secrets Manager read, CloudWatch logs
  * Secrets Manager secret `casa-coqui/firebase-service-account` (RETAIN)

Removal policy layout:
  S3 bucket=RETAIN, Secret=RETAIN, Lambda log group=DESTROY,
  ReceiptRuleSet=DESTROY (stateless routing config, recreatable).
"""
import os

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_logs as logs,
    aws_route53 as route53,
    aws_s3 as s3,
    aws_secretsmanager as sm,
    aws_ses as ses,
    aws_ses_actions as ses_actions,
)
from constructs import Construct


INBOUND_DOMAIN = "inbox.casa-coqui.cc"
ROOT_DOMAIN = "casa-coqui.cc"
RECEIPT_ADDRESS = f"airbnb@{INBOUND_DOMAIN}"
EMAIL_BUCKET_NAME = "casa-coqui-inbound-email"
LAMBDA_FUNCTION_NAME = "casa-coqui-parse-airbnb-email"
RECEIPT_RULE_SET_NAME = "casa-coqui-inbound"
RECEIPT_RULE_NAME = "airbnb-receipts"


class CasaCoquiEmailStack(Stack):
    """Inbound email pipeline: SES → S3 → Lambda → Firestore."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 1. Hosted zone lookup — existing zone, not managed by this stack
        # ------------------------------------------------------------------
        # fromLookup performs a live Route53 API call at synth time and caches
        # the result in cdk.context.json. The zone is NOT deleted if this stack
        # is torn down.
        hosted_zone = route53.HostedZone.from_lookup(
            self,
            "RootHostedZone",
            domain_name=ROOT_DOMAIN,
        )

        # ------------------------------------------------------------------
        # 2. MX record — route inbound mail to SES
        # ------------------------------------------------------------------
        # Priority 10 is the lowest-priority (and only) MX record for the
        # inbox subdomain. SES inbound SMTP endpoint is region-scoped.
        route53.MxRecord(
            self,
            "InboundMxRecord",
            zone=hosted_zone,
            record_name=INBOUND_DOMAIN,
            values=[
                route53.MxRecordValue(
                    host_name=f"inbound-smtp.{self.region}.amazonaws.com",
                    priority=10,
                )
            ],
            ttl=Duration.minutes(5),
            comment="SES inbound SMTP for Casa Coqui receipt parsing",
        )

        # ------------------------------------------------------------------
        # 3. SES EmailIdentity for inbox subdomain with auto-DKIM
        # ------------------------------------------------------------------
        # CDK creates the SES domain identity and automatically generates
        # three CNAME records in the hosted zone for EasyDKIM verification.
        # dkim_signing=True (default) is made explicit for clarity.
        email_identity = ses.EmailIdentity(
            self,
            "InboxEmailIdentity",
            identity=ses.Identity.domain(INBOUND_DOMAIN),
            dkim_signing=True,
            mail_from_domain=INBOUND_DOMAIN,
        )

        # ------------------------------------------------------------------
        # 4. TXT SPF record
        # ------------------------------------------------------------------
        route53.TxtRecord(
            self,
            "InboxSpfRecord",
            zone=hosted_zone,
            record_name=INBOUND_DOMAIN,
            values=["v=spf1 include:amazonses.com ~all"],
            ttl=Duration.minutes(5),
            comment="SPF record authorising SES to send from inbox subdomain",
        )

        # ------------------------------------------------------------------
        # 5. S3 bucket for raw inbound emails
        # ------------------------------------------------------------------
        # RETAIN: raw emails are source-of-truth for receipt data; losing
        # them would require re-forwarding from the originating mailbox.
        self.email_bucket = s3.Bucket(
            self,
            "InboundEmailBucket",
            bucket_name=EMAIL_BUCKET_NAME,
            versioned=False,
            enforce_ssl=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="expire-old-emails",
                    enabled=True,
                    expiration=Duration.days(90),
                    abort_incomplete_multipart_upload_after=Duration.days(1),
                )
            ],
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,  # REQUIRED when removal_policy=RETAIN
        )

        # SES needs s3:PutObject permission on the bucket to deliver mail.
        # This must be a bucket policy (resource-based), not an IAM policy,
        # because SES acts as an AWS service principal, not as an IAM role.
        self.email_bucket.add_to_resource_policy(
            iam.PolicyStatement(
                sid="AllowSESPutObject",
                principals=[iam.ServicePrincipal("ses.amazonaws.com")],
                actions=["s3:PutObject"],
                resources=[f"{self.email_bucket.bucket_arn}/*"],
                conditions={
                    "StringEquals": {
                        "AWS:SourceAccount": self.account,
                    }
                },
            )
        )

        # ------------------------------------------------------------------
        # 6. Secrets Manager — Firebase service account JSON
        # ------------------------------------------------------------------
        # Separate secret from the pipeline secret so the Lambda's IAM policy
        # can be scoped narrowly. Real value set out-of-band:
        #   aws secretsmanager put-secret-value \
        #     --secret-id casa-coqui/firebase-service-account \
        #     --secret-string file:///path/to/serviceAccount.json
        self.firebase_secret = sm.Secret(
            self,
            "FirebaseServiceAccountSecret",
            secret_name="casa-coqui/firebase-service-account",
            description=(
                "Firebase Admin SDK service account JSON for the "
                "Airbnb email parser Lambda. Set value out-of-band."
            ),
            generate_secret_string=sm.SecretStringGenerator(
                secret_string_template='{"type": "service_account"}',
                generate_string_key="_placeholder",
                exclude_punctuation=True,
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ------------------------------------------------------------------
        # 7. Lambda IAM role
        # ------------------------------------------------------------------
        lambda_role = iam.Role(
            self,
            "ParseEmailLambdaRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description=(
                "Casa Coqui parse-airbnb-email Lambda: "
                "S3 read, Secrets Manager read, CloudWatch logs"
            ),
        )

        # S3: read raw emails (no write needed — SES writes, Lambda reads)
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="ReadInboundEmails",
                actions=[
                    "s3:GetObject",
                    "s3:GetObjectAttributes",
                    "s3:ListBucket",
                ],
                resources=[
                    self.email_bucket.bucket_arn,
                    f"{self.email_bucket.bucket_arn}/*",
                ],
            )
        )

        # Secrets Manager: read Firebase service account
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="ReadFirebaseSecret",
                actions=[
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                ],
                resources=[
                    self.firebase_secret.secret_arn,
                    f"{self.firebase_secret.secret_arn}-*",
                ],
            )
        )

        # CloudWatch Logs: Lambda execution logs
        # (basic execution role subset — no managed policy attachment needed)
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="WriteLambdaLogs",
                actions=[
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources=[
                    f"arn:aws:logs:{self.region}:{self.account}:log-group:/aws/lambda/{LAMBDA_FUNCTION_NAME}",
                    f"arn:aws:logs:{self.region}:{self.account}:log-group:/aws/lambda/{LAMBDA_FUNCTION_NAME}:*",
                ],
            )
        )

        # ------------------------------------------------------------------
        # 8. CloudWatch log group for the Lambda (explicit retention)
        # ------------------------------------------------------------------
        # Without this, Lambda auto-creates a log group with infinite
        # retention — the same cost trap as CodeBuild log groups.
        lambda_log_group = logs.LogGroup(
            self,
            "ParseEmailLambdaLogGroup",
            log_group_name=f"/aws/lambda/{LAMBDA_FUNCTION_NAME}",
            retention=logs.RetentionDays.THREE_MONTHS,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ------------------------------------------------------------------
        # 9. Lambda function
        # ------------------------------------------------------------------
        # Source code lives at infra/lambda/parse-airbnb-email/
        # CDK bundles the directory as-is (no bundling/transpile for Phase 3;
        # the handler is a placeholder and will be extended in Phase 4).
        lambda_asset_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "lambda",
            "parse-airbnb-email",
        )

        self.parse_lambda = lambda_.Function(
            self,
            "ParseAirbnbEmailLambda",
            function_name=LAMBDA_FUNCTION_NAME,
            description=(
                "Reads raw Airbnb confirmation emails from S3, "
                "parses receipt data, and stores results in Firestore."
            ),
            runtime=lambda_.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=lambda_.Code.from_asset(lambda_asset_path),
            role=lambda_role,
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "EMAIL_BUCKET_NAME": EMAIL_BUCKET_NAME,
                "FIREBASE_SECRET_ARN": self.firebase_secret.secret_arn,
                "NODE_ENV": "production",
            },
            log_group=lambda_log_group,
        )

        # SES needs permission to invoke the Lambda. The source-account
        # condition prevents confused deputy attacks from other accounts.
        self.parse_lambda.add_permission(
            "AllowSESInvoke",
            principal=iam.ServicePrincipal("ses.amazonaws.com"),
            action="lambda:InvokeFunction",
            source_account=self.account,
        )

        # ------------------------------------------------------------------
        # 10. SES Receipt Rule Set + Rule
        # ------------------------------------------------------------------
        # Only one receipt rule set can be "active" at a time in a region.
        # This creates and activates the rule set for Casa Coqui.
        rule_set = ses.ReceiptRuleSet(
            self,
            "InboundReceiptRuleSet",
            receipt_rule_set_name=RECEIPT_RULE_SET_NAME,
            drop_spam=True,
        )
        rule_set.apply_removal_policy(RemovalPolicy.DESTROY)

        # Rule: match mail to airbnb@inbox.casa-coqui.cc
        # Actions execute in order: (1) save to S3, (2) invoke Lambda
        rule_set.add_rule(
            "AirbnbReceiptsRule",
            rule_name=RECEIPT_RULE_NAME,
            recipients=[RECEIPT_ADDRESS],
            actions=[
                ses_actions.S3(
                    bucket=self.email_bucket,
                    object_key_prefix="airbnb/",
                ),
                ses_actions.Lambda(
                    function=self.parse_lambda,
                    invocation_type=ses_actions.LambdaInvocationType.EVENT,
                ),
            ],
            scan_enabled=True,
            tls_policy=ses.TlsPolicy.REQUIRE,
            enabled=True,
        )

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(
            self,
            "EmailBucketName",
            value=self.email_bucket.bucket_name,
            description="S3 bucket receiving raw inbound emails from SES",
            export_name="CasaCoquiEmail-EmailBucketName",
        )
        CfnOutput(
            self,
            "EmailBucketArn",
            value=self.email_bucket.bucket_arn,
            description="ARN of the inbound email S3 bucket",
            export_name="CasaCoquiEmail-EmailBucketArn",
        )
        CfnOutput(
            self,
            "ParseLambdaArn",
            value=self.parse_lambda.function_arn,
            description="ARN of the Airbnb email parser Lambda",
            export_name="CasaCoquiEmail-ParseLambdaArn",
        )
        CfnOutput(
            self,
            "ParseLambdaName",
            value=self.parse_lambda.function_name,
            description="Name of the Airbnb email parser Lambda",
            export_name="CasaCoquiEmail-ParseLambdaName",
        )
        CfnOutput(
            self,
            "FirebaseSecretArn",
            value=self.firebase_secret.secret_arn,
            description="Secrets Manager ARN for Firebase service account JSON",
            export_name="CasaCoquiEmail-FirebaseSecretArn",
        )
        CfnOutput(
            self,
            "ReceiptRuleSetName",
            value=rule_set.receipt_rule_set_name,
            description="SES receipt rule set name",
            export_name="CasaCoquiEmail-ReceiptRuleSetName",
        )
        CfnOutput(
            self,
            "InboundDomain",
            value=INBOUND_DOMAIN,
            description="Subdomain configured to receive Casa Coqui inbound emails",
            export_name="CasaCoquiEmail-InboundDomain",
        )
