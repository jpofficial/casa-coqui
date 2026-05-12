"""
Mi Itinerario stack — DynamoDB tables, Lambda functions, API Gateway HTTP API.

Resources:
  - activities          DDB table (PK=activity_id, GSI=neighborhood+type)
  - itineraries         DDB table (PK=plan_id, TTL=ttl_epoch)
  - itinerary_generate  Lambda
  - itinerary_refine    Lambda
  - HttpApi             API Gateway HTTP API
"""
import aws_cdk as cdk
from aws_cdk import (
    Stack,
    aws_dynamodb as ddb,
    aws_lambda as _lambda,
    aws_apigatewayv2 as apigw,
    aws_apigatewayv2_integrations as apigw_int,
    aws_iam as iam,
    aws_cloudwatch as cw,
    aws_secretsmanager as secrets,
    aws_scheduler as scheduler,
    Duration,
    RemovalPolicy,
)
from constructs import Construct


class MiItinerarioStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Activities table — seeded ~85 items, AI reads at generation time
        self.activities_table = ddb.Table(
            self,
            "ActivitiesTable",
            table_name="mi-itinerario-activities",
            partition_key=ddb.Attribute(name="activity_id", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
            encryption=ddb.TableEncryption.AWS_MANAGED,
            point_in_time_recovery=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # GSI for filtering by neighborhood + type
        self.activities_table.add_global_secondary_index(
            index_name="neighborhood-type-index",
            partition_key=ddb.Attribute(name="neighborhood", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="type", type=ddb.AttributeType.STRING),
            projection_type=ddb.ProjectionType.ALL,
        )

        cdk.CfnOutput(
            self,
            "ActivitiesTableName",
            value=self.activities_table.table_name,
            export_name="MiItinerarioActivitiesTable",
        )

        # Itineraries table — anonymous plans w/ 90-day TTL, persistent if user_id set
        self.itineraries_table = ddb.Table(
            self,
            "ItinerariesTable",
            table_name="mi-itinerario-itineraries",
            partition_key=ddb.Attribute(name="plan_id", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
            encryption=ddb.TableEncryption.AWS_MANAGED,
            point_in_time_recovery=True,
            time_to_live_attribute="ttl_epoch",
            removal_policy=RemovalPolicy.RETAIN,
        )

        cdk.CfnOutput(
            self,
            "ItinerariesTableName",
            value=self.itineraries_table.table_name,
            export_name="MiItinerarioItinerariesTable",
        )

        # Events cache — Eventbrite results, auto-expire 1 day after event end
        self.events_cache_table = ddb.Table(
            self,
            "EventsCacheTable",
            table_name="mi-itinerario-events-cache",
            partition_key=ddb.Attribute(name="date_iso", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="event_id", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
            encryption=ddb.TableEncryption.AWS_MANAGED,
            point_in_time_recovery=False,  # events are ephemeral, no need
            time_to_live_attribute="ttl_epoch",
            removal_policy=RemovalPolicy.RETAIN,
        )

        cdk.CfnOutput(
            self,
            "EventsCacheTableName",
            value=self.events_cache_table.table_name,
            export_name="MiItinerarioEventsCacheTable",
        )

        # ── Secrets Manager reference ─────────────────────────────────────────
        # References existing secret (created manually via AWS CLI / console)
        self.eventbrite_secret = secrets.Secret.from_secret_name_v2(
            self,
            "EventbriteToken",
            "mi-itinerario/eventbrite-token",
        )

        # ── events-fetch Lambda — hourly Eventbrite poller ────────────────────
        events_fetch_fn = _lambda.Function(
            self,
            "EventsFetchFn",
            runtime=_lambda.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=_lambda.Code.from_asset(
                "lambdas/events_fetch",
                bundling=cdk.BundlingOptions(
                    image=_lambda.Runtime.NODEJS_20_X.bundling_image,
                    command=["bash", "-c", "npm install --omit=dev --cache /tmp/.npm && cp -r . /asset-output"],
                ),
            ),
            timeout=Duration.seconds(60),
            memory_size=256,
            environment={
                "EVENTS_CACHE_TABLE": self.events_cache_table.table_name,
                "EVENTBRITE_SECRET_NAME": "mi-itinerario/eventbrite-token",
            },
        )
        self.events_cache_table.grant_write_data(events_fetch_fn)
        self.eventbrite_secret.grant_read(events_fetch_fn)

        self.events_fetch_fn = events_fetch_fn

        cdk.CfnOutput(
            self,
            "EventsFetchFnName",
            value=events_fetch_fn.function_name,
            export_name="MiItinerarioEventsFetchFn",
        )

        # EventBridge Scheduler — fires every hour
        scheduler_role = iam.Role(
            self,
            "EventsFetchSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
        )
        events_fetch_fn.grant_invoke(scheduler_role)

        scheduler.CfnSchedule(
            self,
            "EventsFetchSchedule",
            schedule_expression="rate(1 hour)",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(mode="OFF"),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=events_fetch_fn.function_arn,
                role_arn=scheduler_role.role_arn,
            ),
        )

        # itinerary-generate Lambda
        generate_fn = _lambda.Function(
            self,
            "ItineraryGenerateFn",
            runtime=_lambda.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=_lambda.Code.from_asset(
                "lambdas/itinerary_generate",
                bundling=cdk.BundlingOptions(
                    image=_lambda.Runtime.NODEJS_20_X.bundling_image,
                    command=["bash", "-c", "npm install --omit=dev --cache /tmp/.npm && cp -r . /asset-output"],
                ),
            ),
            timeout=Duration.seconds(30),
            memory_size=512,
            environment={
                "ACTIVITIES_TABLE": self.activities_table.table_name,
                "ITINERARIES_TABLE": self.itineraries_table.table_name,
            },
        )

        self.activities_table.grant_read_data(generate_fn)
        self.itineraries_table.grant_write_data(generate_fn)

        # Bedrock invocation permission for Claude Haiku
        generate_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[
                    # Cross-region inference profile (required for Haiku 4.5 on-demand)
                    f"arn:aws:bedrock:us-east-1:{self.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
                    # Underlying foundation models across the 3 routed regions
                    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                    "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                    "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                ],
            )
        )

        self.generate_fn = generate_fn

        cdk.CfnOutput(
            self,
            "ItineraryGenerateFnName",
            value=generate_fn.function_name,
            export_name="MiItinerarioGenerateFnName",
        )

        # itinerary-refine Lambda
        refine_fn = _lambda.Function(
            self,
            "ItineraryRefineFn",
            runtime=_lambda.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=_lambda.Code.from_asset(
                "lambdas/itinerary_refine",
                bundling=cdk.BundlingOptions(
                    image=_lambda.Runtime.NODEJS_20_X.bundling_image,
                    command=["bash", "-c", "npm install --omit=dev --cache /tmp/.npm && cp -r . /asset-output"],
                ),
            ),
            timeout=Duration.seconds(30),
            memory_size=512,
            environment={
                "ACTIVITIES_TABLE": self.activities_table.table_name,
                "ITINERARIES_TABLE": self.itineraries_table.table_name,
            },
        )
        self.activities_table.grant_read_data(refine_fn)
        self.itineraries_table.grant_read_write_data(refine_fn)

        refine_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[
                    # Cross-region inference profile (required for Haiku 4.5 on-demand)
                    f"arn:aws:bedrock:us-east-1:{self.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
                    # Underlying foundation models across the 3 routed regions
                    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                    "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                    "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                ],
            )
        )

        self.refine_fn = refine_fn

        # ── CloudWatch Alarms ─────────────────────────────────────────────────
        cw.Alarm(
            self,
            "GenerateFnErrorsAlarm",
            metric=generate_fn.metric_errors(period=Duration.minutes(5)),
            threshold=10,
            evaluation_periods=1,
            alarm_description="Itinerary generate function errors >10 in 5 min",
        )

        cw.Alarm(
            self,
            "GenerateFnDurationAlarm",
            metric=generate_fn.metric_duration(period=Duration.minutes(5)),
            threshold=25_000,  # ms
            evaluation_periods=2,
            alarm_description="Itinerary generation slower than 25s p99",
        )

        # ── HTTP API ──────────────────────────────────────────────────────────
        http_api = apigw.HttpApi(
            self,
            "ItineraryHttpApi",
            api_name="mi-itinerario-api",
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=["*"],  # tighten to casa-coqui.cc domains before prod
                allow_methods=[apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.OPTIONS],
                allow_headers=["content-type"],
            ),
        )

        http_api.add_routes(
            path="/generate",
            methods=[apigw.HttpMethod.POST],
            integration=apigw_int.HttpLambdaIntegration("GenerateInt", generate_fn),
        )

        http_api.add_routes(
            path="/refine",
            methods=[apigw.HttpMethod.POST],
            integration=apigw_int.HttpLambdaIntegration("RefineInt", refine_fn),
        )

        self.http_api = http_api

        cdk.CfnOutput(self, "HttpApiUrl", value=http_api.api_endpoint, export_name="MiItinerarioApiUrl")
