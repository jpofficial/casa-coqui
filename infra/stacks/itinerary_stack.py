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
        # Tables, Lambdas, API GW will be added in subsequent tasks
        pass
