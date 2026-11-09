"""
CasaCoquiFoundationStack — assertion + snapshot tests.

The Foundation stack is the create-once/never-delete layer, so the properties
pinned here are the ones that would hurt if they regressed silently: retention
policies, encryption, public-access blocks, log retention, and the export names
the Pipeline stack imports.
"""
import aws_cdk as cdk
from aws_cdk.assertions import Match, Template

from tests.helpers import TEST_ENV, assert_matches_snapshot
from stacks.foundation_stack import CasaCoquiFoundationStack

NOTIFICATION_EMAIL = "ops@example.com"


def synth(app: cdk.App) -> Template:
    stack = CasaCoquiFoundationStack(
        app,
        "CasaCoquiFoundationStack",
        env=TEST_ENV,
        notification_email=NOTIFICATION_EMAIL,
    )
    return Template.from_stack(stack)


def test_resource_inventory(app):
    template = synth(app)
    template.resource_count_is("AWS::KMS::Key", 1)
    template.resource_count_is("AWS::KMS::Alias", 1)
    template.resource_count_is("AWS::S3::Bucket", 1)
    template.resource_count_is("AWS::SecretsManager::Secret", 1)
    template.resource_count_is("AWS::SNS::Topic", 1)
    template.resource_count_is("AWS::SNS::Subscription", 1)
    template.resource_count_is("AWS::SSM::Parameter", 1)
    template.resource_count_is("AWS::Logs::LogGroup", 1)


def test_cmk_rotates_and_is_retained(app):
    template = synth(app)
    template.has_resource(
        "AWS::KMS::Key",
        {
            "Properties": Match.object_like(
                {"EnableKeyRotation": True, "PendingWindowInDays": 7}
            ),
            "DeletionPolicy": "Retain",
            "UpdateReplacePolicy": "Retain",
        },
    )
    template.has_resource_properties(
        "AWS::KMS::Alias", {"AliasName": "alias/casa-coqui/pipeline"}
    )


def test_cmk_grants_the_service_principals_that_need_it(app):
    template = synth(app)
    key = template.find_resources("AWS::KMS::Key")
    statements = next(iter(key.values()))["Properties"]["KeyPolicy"]["Statement"]
    services = set()
    for statement in statements:
        principal = statement.get("Principal", {})
        service = principal.get("Service")
        if isinstance(service, str):
            services.add(service)
        elif isinstance(service, dict):
            # logs.<region>.amazonaws.com is built with Fn::Join; just note it.
            services.add("logs.<region>.amazonaws.com")
    for expected in (
        "sns.amazonaws.com",
        "events.amazonaws.com",
        "codepipeline.amazonaws.com",
        "codebuild.amazonaws.com",
    ):
        assert expected in services, f"{expected} missing from CMK key policy"
    assert any(s.startswith("logs.") for s in services), "CloudWatch Logs grant missing"


def test_artifact_bucket_is_locked_down_and_retained(app):
    template = synth(app)
    template.has_resource(
        "AWS::S3::Bucket",
        {
            "Properties": Match.object_like(
                {
                    "VersioningConfiguration": {"Status": "Enabled"},
                    "PublicAccessBlockConfiguration": {
                        "BlockPublicAcls": True,
                        "BlockPublicPolicy": True,
                        "IgnorePublicAcls": True,
                        "RestrictPublicBuckets": True,
                    },
                    "BucketEncryption": {
                        "ServerSideEncryptionConfiguration": [
                            Match.object_like(
                                {
                                    "BucketKeyEnabled": True,
                                    "ServerSideEncryptionByDefault": Match.object_like(
                                        {"SSEAlgorithm": "aws:kms"}
                                    ),
                                }
                            )
                        ]
                    },
                    "LifecycleConfiguration": {
                        "Rules": Match.array_with(
                            [
                                Match.object_like(
                                    {
                                        "Id": "expire-old-artifacts",
                                        "Status": "Enabled",
                                        "ExpirationInDays": 30,
                                        "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
                                        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                                    }
                                )
                            ]
                        )
                    },
                }
            ),
            "DeletionPolicy": "Retain",
            "UpdateReplacePolicy": "Retain",
        },
    )


def test_artifact_bucket_enforces_tls(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::S3::BucketPolicy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {
                                "Effect": "Deny",
                                "Action": "s3:*",
                                "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                            }
                        )
                    ]
                )
            }
        },
    )


def test_pipeline_secret_name_and_retention(app):
    template = synth(app)
    template.has_resource(
        "AWS::SecretsManager::Secret",
        {
            "Properties": Match.object_like({"Name": "casa-coqui/pipeline"}),
            "DeletionPolicy": "Retain",
            "UpdateReplacePolicy": "Retain",
        },
    )
    secret = next(iter(template.find_resources("AWS::SecretsManager::Secret").values()))
    assert "KmsKeyId" in secret["Properties"], "pipeline secret must use the CMK"


def test_notifications_topic_is_encrypted_and_emails_the_operator(app):
    template = synth(app)
    template.has_resource(
        "AWS::SNS::Topic",
        {
            "Properties": Match.object_like(
                {"TopicName": "casa-coqui-pipeline-events", "KmsMasterKeyId": Match.any_value()}
            ),
            # Deliberately NOT retained — recreating forces re-confirmation anyway.
            "DeletionPolicy": "Delete",
        },
    )
    template.has_resource_properties(
        "AWS::SNS::Subscription",
        {"Protocol": "email", "Endpoint": NOTIFICATION_EMAIL},
    )


def test_codestar_connection_parameter_is_a_placeholder(app):
    template = synth(app)
    template.has_resource(
        "AWS::SSM::Parameter",
        {
            "Properties": Match.object_like(
                {
                    "Name": "/casa-coqui/pipeline/codestar-connection-arn",
                    "Type": "String",
                    "Value": "PLACEHOLDER_SET_VIA_AWS_SSM_PUT_PARAMETER",
                }
            ),
            "DeletionPolicy": "Retain",
        },
    )


def test_secrets_audit_log_group_has_finite_retention(app):
    template = synth(app)
    template.has_resource(
        "AWS::Logs::LogGroup",
        {
            "Properties": Match.object_like(
                {
                    "LogGroupName": "/aws/secretsmanager/casa-coqui-pipeline-access",
                    "RetentionInDays": 90,
                    "KmsKeyId": Match.any_value(),
                }
            ),
            "DeletionPolicy": "Delete",
        },
    )


def test_exports_consumed_by_the_pipeline_stack(app):
    template = synth(app)
    expected_exports = {
        "ArtifactBucketName": "CasaCoquiFoundation-ArtifactBucketName",
        "CmkArn": "CasaCoquiFoundation-CmkArn",
        "PipelineSecretArn": "CasaCoquiFoundation-PipelineSecretArn",
        "NotificationsTopicArn": "CasaCoquiFoundation-NotificationsTopicArn",
        "CodeStarConnectionParamName": "CasaCoquiFoundation-CodeStarConnectionParamName",
    }
    for logical_id, export_name in expected_exports.items():
        template.has_output(logical_id, {"Export": {"Name": export_name}})


def test_template_snapshot(app):
    # Full-template snapshot. The Foundation stack has no file assets, so the
    # synthesized template is byte-stable across machines.
    assert_matches_snapshot(synth(app), "CasaCoquiFoundationStack")
