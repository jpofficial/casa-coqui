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
