"""
CasaCoquiEmailStack — assertion tests for the SES → S3 → Lambda pipeline.

No snapshot for this stack: the Lambda is packaged with `Code.from_asset`, so
the template carries an asset hash that depends on the exact contents of
infra/lambda/parse-airbnb-email/ (including any installed node_modules).
The behavioural properties below are what matter.
"""
import aws_cdk as cdk
from aws_cdk.assertions import Match, Template

from tests.helpers import TEST_ENV
from stacks.email_stack import (
    CasaCoquiEmailStack,
    EMAIL_BUCKET_NAME,
    INBOUND_DOMAIN,
    LAMBDA_FUNCTION_NAME,
    RECEIPT_ADDRESS,
    RECEIPT_RULE_SET_NAME,
)


def synth(app: cdk.App) -> Template:
    # HostedZone.from_lookup needs a concrete env; with no cached context the
    # CDK substitutes a dummy zone and records the lookup as "missing", which
    # is exactly what we want in a unit test.
    stack = CasaCoquiEmailStack(app, "CasaCoquiEmailStack", env=TEST_ENV)
    return Template.from_stack(stack)


def test_resource_inventory(app):
    template = synth(app)
    template.resource_count_is("AWS::S3::Bucket", 1)
    # 2 functions: the parser itself + the singleton DropSpam Lambda that
    # `ReceiptRuleSet(drop_spam=True)` adds in front of every rule.
    template.resource_count_is("AWS::Lambda::Function", 2)
    template.resource_count_is("AWS::SES::ReceiptRuleSet", 1)
    template.resource_count_is("AWS::SES::ReceiptRule", 2)  # DropSpam + airbnb-receipts
    template.resource_count_is("AWS::SES::EmailIdentity", 1)
    # MX + SPF only: the EmailIdentity is a bare domain identity (not bound to
    # the hosted zone), so CDK does not synthesize the three DKIM CNAMEs.
    template.resource_count_is("AWS::Route53::RecordSet", 2)
    template.resource_count_is("AWS::Logs::LogGroup", 1)


def test_inbound_bucket_is_retained_with_90_day_expiry(app):
    template = synth(app)
    template.has_resource(
        "AWS::S3::Bucket",
        {
            "Properties": Match.object_like(
                {
                    "BucketName": EMAIL_BUCKET_NAME,
                    "PublicAccessBlockConfiguration": Match.object_like(
                        {"BlockPublicAcls": True, "RestrictPublicBuckets": True}
                    ),
                    "LifecycleConfiguration": {
                        "Rules": Match.array_with(
                            [
                                Match.object_like(
                                    {"Id": "expire-old-emails", "Status": "Enabled", "ExpirationInDays": 90}
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


def test_ses_may_write_to_the_bucket_only_from_this_account(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::S3::BucketPolicy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {
                                "Sid": "AllowSESPutObject",
                                "Effect": "Allow",
                                "Action": "s3:PutObject",
                                "Principal": {"Service": "ses.amazonaws.com"},
                                "Condition": {
                                    "StringEquals": {"AWS:SourceAccount": TEST_ENV.account}
                                },
                            }
                        )
                    ]
                )
            }
        },
    )


def test_parser_lambda_shape(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::Lambda::Function",
        Match.object_like(
            {
                "FunctionName": LAMBDA_FUNCTION_NAME,
                "Runtime": "nodejs20.x",
                "Handler": "index.handler",
                "Timeout": 60,
                "MemorySize": 256,
                "Environment": {
                    "Variables": Match.object_like(
                        {
                            "EMAIL_BUCKET_NAME": EMAIL_BUCKET_NAME,
                            "ANTHROPIC_SECRET_NAME": "casa-coqui/anthropic-api-key",
                            "NODE_ENV": "production",
                            "FIREBASE_SECRET_ARN": Match.any_value(),
                        }
                    )
                },
            }
        ),
    )


def test_lambda_role_is_least_privilege(app):
    template = synth(app)
    policies = [
        p
        for p in template.find_resources("AWS::IAM::Policy").values()
        if any(ref.get("Ref", "").startswith("ParseEmailLambdaRole") for ref in p["Properties"]["Roles"])
    ]
    assert len(policies) == 1, "expected exactly one inline policy on the parser role"
    statements = {s["Sid"]: s for s in policies[0]["Properties"]["PolicyDocument"]["Statement"]}

    assert set(statements) == {"ReadInboundEmails", "ReadSecrets", "WriteLambdaLogs"}
    assert sorted(statements["ReadInboundEmails"]["Action"]) == [
        "s3:GetObject",
        "s3:GetObjectAttributes",
        "s3:ListBucket",
    ]
    assert sorted(statements["ReadSecrets"]["Action"]) == [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
    ]
    # Nothing in the role may write to S3 or touch Firestore-adjacent services.
    for statement in statements.values():
        actions = statement["Action"] if isinstance(statement["Action"], list) else [statement["Action"]]
        assert not any(a.startswith("s3:Put") or a.startswith("s3:Delete") for a in actions)


def test_ses_can_invoke_the_lambda_only_from_this_account(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::Lambda::Permission",
        {
            "Action": "lambda:InvokeFunction",
            "Principal": "ses.amazonaws.com",
            "SourceAccount": TEST_ENV.account,
        },
    )


def test_receipt_rule_saves_to_s3_then_invokes_lambda(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::SES::ReceiptRuleSet", {"RuleSetName": RECEIPT_RULE_SET_NAME}
    )
    rules = template.find_resources("AWS::SES::ReceiptRule")
    # drop_spam=True prepends a DropSpam rule; ours is the one with recipients
    # and it must be ordered *after* the spam filter.
    airbnb_rules = [r for r in rules.values() if "Recipients" in r["Properties"]["Rule"]]
    assert len(airbnb_rules) == 1
    rule = airbnb_rules[0]
    assert "After" in rule["Properties"], "airbnb-receipts rule must run after DropSpam"
    props = rule["Properties"]["Rule"]
    assert props["Recipients"] == [RECEIPT_ADDRESS]
    assert props["Enabled"] is True
    assert props["ScanEnabled"] is True
    assert props["TlsPolicy"] == "Require"

    actions = props["Actions"]
    assert len(actions) == 2, "expected exactly S3 then Lambda"
    assert "S3Action" in actions[0] and actions[0]["S3Action"]["ObjectKeyPrefix"] == "airbnb/"
    assert "LambdaAction" in actions[1] and actions[1]["LambdaAction"]["InvocationType"] == "Event"


def test_lambda_log_group_has_finite_retention(app):
    template = synth(app)
    template.has_resource(
        "AWS::Logs::LogGroup",
        {
            "Properties": Match.object_like(
                {"LogGroupName": f"/aws/lambda/{LAMBDA_FUNCTION_NAME}", "RetentionInDays": 90}
            ),
            "DeletionPolicy": "Delete",
        },
    )


def test_dns_records_for_the_inbound_subdomain(app):
    template = synth(app)
    template.has_resource_properties(
        "AWS::Route53::RecordSet",
        Match.object_like(
            {
                "Name": f"{INBOUND_DOMAIN}.",
                "Type": "MX",
                "ResourceRecords": ["10 inbound-smtp.us-east-1.amazonaws.com"],
            }
        ),
    )
    template.has_resource_properties(
        "AWS::Route53::RecordSet",
        Match.object_like(
            {
                "Name": f"{INBOUND_DOMAIN}.",
                "Type": "TXT",
                "ResourceRecords": ['"v=spf1 include:amazonses.com ~all"'],
            }
        ),
    )


def test_exports(app):
    template = synth(app)
    for logical_id, export_name in {
        "EmailBucketName": "CasaCoquiEmail-EmailBucketName",
        "ParseLambdaArn": "CasaCoquiEmail-ParseLambdaArn",
        "ReceiptRuleSetName": "CasaCoquiEmail-ReceiptRuleSetName",
        "InboundDomain": "CasaCoquiEmail-InboundDomain",
    }.items():
        template.has_output(logical_id, {"Export": {"Name": export_name}})
