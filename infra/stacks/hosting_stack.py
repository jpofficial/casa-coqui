"""
CasaCoquiHostingStack — EC2 hosting layer for Casa Coqui.

Replaces Vercel with a self-managed EC2 instance running Next.js behind
an Application Load Balancer with SSL via ACM.

Resources:
  * Security Groups (ALB + EC2)
  * IAM Instance Profile (CodeDeploy agent, SSM, Secrets Manager)
  * IAM CodeDeploy Service Role
  * EC2 Instance (Amazon Linux 2023, t3.micro — free tier)
  * Elastic IP
  * Application Load Balancer + Target Group + Listeners
  * ACM Certificate (DNS-validated via Route53)
  * CodeDeploy Application + Deployment Group
  * Route53 A Record (casa-coqui.cc → ALB)

Cost: ~$16.50/month (ALB fixed cost — temporary for exam practice).
EC2 + EBS + bandwidth covered by free tier for 12 months.

DOP-C02 exam topics:
  - EC2 user data scripts (bootstrap on first boot)
  - IAM instance profiles vs IAM roles (profile = container for role)
  - Security groups (stateful — return traffic auto-allowed)
  - ALB health checks (target group level, not instance level)
  - CodeDeploy in-place deployment with ALB traffic hooks
  - ACM certificate DNS validation via Route53
  - Cross-stack references (Foundation → Hosting via artifact bucket + secret)

Lifecycle: REBUILDABLE — can `cdk destroy` without losing data.
Foundation stack resources (KMS, S3, Secrets) are unaffected.
"""

import aws_cdk as cdk
from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_autoscaling as autoscaling,
    aws_certificatemanager as acm,
    aws_cloudwatch as cloudwatch,
    aws_codedeploy as codedeploy,
    aws_ec2 as ec2,
    aws_elasticloadbalancingv2 as elbv2,
    aws_elasticloadbalancingv2_targets as elbv2_targets,
    aws_iam as iam,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
)
from constructs import Construct


class CasaCoquiHostingStack(Stack):
    """EC2 + ALB hosting for Casa Coqui. Temporary ALB for exam practice."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        artifact_bucket_name: str,
        pipeline_secret_arn: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # 0. Look up existing resources
        # ------------------------------------------------------------------

        # Artifact bucket — already deployed by Foundation stack.
        # We look it up by name instead of passing the construct directly.
        # DOP-C02 exam note: from_bucket_name() creates a reference to an
        # existing bucket. It does NOT create a new bucket. CDK uses this
        # to generate the correct ARN for IAM policies.
        artifact_bucket = s3.Bucket.from_bucket_name(
            self, "ArtifactBucket", artifact_bucket_name
        )

        # Default VPC — we're not creating a custom VPC for this exercise.
        # DOP-C02 exam note: Default VPC has public subnets in every AZ,
        # internet gateway attached, and a default security group. Using it
        # avoids NAT Gateway costs ($32/month per AZ).
        vpc = ec2.Vpc.from_lookup(self, "DefaultVpc", is_default=True)

        # Route53 hosted zone for casa-coqui.cc (already exists).
        hosted_zone = route53.HostedZone.from_lookup(
            self, "HostedZone",
            domain_name="casa-coqui.cc",
        )

        # ------------------------------------------------------------------
        # 1. ACM Certificate
        # ------------------------------------------------------------------
        # DOP-C02 exam note: ACM certs are FREE for use with AWS services
        # (ALB, CloudFront, API Gateway). DNS validation is preferred over
        # email validation because it auto-renews. ACM creates a CNAME record
        # in Route53 to prove domain ownership.
        certificate = acm.Certificate(
            self, "Certificate",
            domain_name="casa-coqui.cc",
            subject_alternative_names=["*.casa-coqui.cc"],
            validation=acm.CertificateValidation.from_dns(hosted_zone),
        )

        # ------------------------------------------------------------------
        # 2. Security Groups
        # ------------------------------------------------------------------

        # ALB security group: accepts traffic from the internet.
        alb_sg = ec2.SecurityGroup(
            self, "AlbSg",
            vpc=vpc,
            description="Casa Coqui ALB - inbound HTTP/HTTPS from internet",
            allow_all_outbound=False,
        )
        alb_sg.add_ingress_rule(
            ec2.Peer.any_ipv4(), ec2.Port.tcp(443), "HTTPS from anywhere"
        )
        alb_sg.add_ingress_rule(
            ec2.Peer.any_ipv4(), ec2.Port.tcp(80), "HTTP from anywhere (redirects to HTTPS)"
        )

        # EC2 security group: ONLY accepts traffic from the ALB.
        # DOP-C02 exam note: Security groups are STATEFUL — if inbound is
        # allowed, the return traffic is automatically allowed. No need for
        # explicit outbound rules for response traffic. This is different
        # from NACLs which are STATELESS.
        ec2_sg = ec2.SecurityGroup(
            self, "Ec2Sg",
            vpc=vpc,
            description="Casa Coqui EC2 - inbound from ALB only",
            allow_all_outbound=True,  # needed for npm install, Firebase SDK, etc.
        )
        ec2_sg.add_ingress_rule(
            alb_sg, ec2.Port.tcp(3000), "Next.js from ALB only"
        )

        # Explicit ALB egress — only to EC2 on port 3000.
        alb_sg.add_egress_rule(ec2_sg, ec2.Port.tcp(3000), "ALB to EC2 on port 3000 only")

        # ------------------------------------------------------------------
        # 3. IAM Role + Instance Profile
        # ------------------------------------------------------------------
        # DOP-C02 exam note: An instance profile is a CONTAINER for an IAM
        # role. EC2 instances don't attach roles directly — they attach
        # instance profiles, which hold exactly one role. CDK creates the
        # instance profile automatically when you pass a role to an EC2 instance.

        ec2_role = iam.Role(
            self, "Ec2Role",
            assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"),
            description="Casa Coqui EC2 - CodeDeploy agent, SSM, Secrets Manager",
            managed_policies=[
                # SSM Session Manager — SSH without opening port 22.
                # DOP-C02 exam note: Session Manager requires the SSM agent
                # (pre-installed on Amazon Linux 2023) and this managed policy.
                # No security group rule needed — SSM uses HTTPS outbound.
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "AmazonSSMManagedInstanceCore"
                ),
            ],
        )

        # CodeDeploy agent needs read-only API access (S3 artifact access
        # comes from artifact_bucket.grant_read below — no broad S3 policy needed).
        ec2_role.add_to_policy(iam.PolicyStatement(
            actions=[
                "codedeploy:BatchGet*",
                "codedeploy:Get*",
                "codedeploy:List*",
            ],
            resources=["*"],
        ))

        # Allow reading the pipeline secret (env vars for Next.js).
        ec2_role.add_to_policy(iam.PolicyStatement(
            actions=["secretsmanager:GetSecretValue"],
            resources=[pipeline_secret_arn],
        ))

        # Allow reading SSM parameters (app URL, etc.).
        ec2_role.add_to_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter", "ssm:GetParameters"],
            resources=[
                f"arn:aws:ssm:{self.region}:{self.account}:parameter/casa-coqui/pipeline/*"
            ],
        ))

        # Allow reading from the artifact bucket (CodeDeploy pulls deployment bundles).
        artifact_bucket.grant_read(ec2_role)

        # Allow decrypting the artifact bucket contents (Foundation stack
        # encrypts the bucket with a KMS CMK). Without this, the EC2 can
        # list/get objects but can't read the actual data.
        # DOP-C02 exam note: S3 grant_read gives s3:GetObject, but if the
        # bucket uses KMS encryption (SSE-KMS), you ALSO need kms:Decrypt
        # on the key. This is a common exam trap — S3 permissions alone
        # aren't enough when KMS is involved.
        ec2_role.add_to_policy(iam.PolicyStatement(
            actions=["kms:Decrypt", "kms:DescribeKey"],
            resources=[
                "arn:aws:kms:us-east-1:524140443248:key/3c534568-f0e6-4d38-b581-d862604669cb"
            ],
        ))

        # ------------------------------------------------------------------
        # 4. EC2 Instance
        # ------------------------------------------------------------------

        # User data script — runs on FIRST BOOT only.
        # DOP-C02 exam note: User data runs as root. It executes once on
        # instance launch (not on stop/start). Logs go to
        # /var/log/cloud-init-output.log. If it fails, the instance still
        # launches — user data failures don't stop the instance.
        user_data = ec2.UserData.for_linux()
        user_data.add_commands(
            "#!/bin/bash",
            "set -euxo pipefail",
            "",
            "# ── Node.js 20 ──",
            "dnf install -y nodejs20 npm",
            "node --version && npm --version",
            "",
            "# ── PM2 (process manager) ──",
            "npm install -g pm2",
            "pm2 --version",
            "",
            "# ── CodeDeploy agent ──",
            "dnf install -y ruby wget",
            "cd /tmp",
            "wget -q https://aws-codedeploy-us-east-1.s3.us-east-1.amazonaws.com/latest/install",
            "chmod +x ./install",
            "./install auto",
            "systemctl enable codedeploy-agent",
            "systemctl start codedeploy-agent",
            "",
            "# ── Nginx (reverse proxy for non-ALB testing) ──",
            "dnf install -y nginx",
            "systemctl enable nginx",
            "",
            "# ── App directory ──",
            "mkdir -p /home/ec2-user/casa-coqui",
            "chown ec2-user:ec2-user /home/ec2-user/casa-coqui",
            "",
            "echo 'User data complete' > /tmp/user-data-done.txt",
        )

        # Amazon Linux 2023 — latest AMI, auto-resolved by CDK.
        # DOP-C02 exam note: CDK uses SSM parameter /aws/service/ami-amazon-linux-latest/*
        # to resolve the latest AMI at deploy time. This means `cdk deploy`
        # always gets the newest patched AMI without hardcoding an AMI ID.
        # DOP-C02 exam note: IMDSv2 (require_imdsv2=True) prevents SSRF
        # credential theft. Without it, any SSRF vulnerability in the app
        # lets an attacker reach http://169.254.169.254 and steal the
        # instance role credentials. IMDSv2 requires a PUT request with a
        # token header — SSRF attacks can't easily forge this.
        instance = ec2.Instance(
            self, "WebServer",
            instance_type=ec2.InstanceType("t3.micro"),
            machine_image=ec2.MachineImage.latest_amazon_linux2023(),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC),
            security_group=ec2_sg,
            role=ec2_role,
            user_data=user_data,
            require_imdsv2=True,
            block_devices=[
                ec2.BlockDevice(
                    device_name="/dev/xvda",
                    volume=ec2.BlockDeviceVolume.ebs(
                        volume_size=20,
                        volume_type=ec2.EbsDeviceVolumeType.GP3,
                        encrypted=True,
                        # DOP-C02 exam note: encrypted=True uses the default
                        # AWS-managed EBS key (aws/ebs). You could also pass
                        # encryption_key=foundation.cmk to use your own CMK.
                        # delete_on_termination=True means the volume is
                        # destroyed when the instance is terminated.
                        delete_on_termination=True,
                    ),
                ),
            ],
        )

        # Tag the instance so CodeDeploy can find it.
        # DOP-C02 exam note: CodeDeploy uses EC2 tags (not instance IDs) to
        # identify deployment targets. This decouples deployments from specific
        # instances — if you replace the instance, the new one just needs
        # the same tag and CodeDeploy finds it automatically.
        cdk.Tags.of(instance).add("Name", "casa-coqui-web")
        cdk.Tags.of(instance).add("Application", "casa-coqui")

        # Security note: No Elastic IP. All traffic routes through the ALB.
        # Direct instance access is via SSM Session Manager (no public IP needed).
        # DOP-C02 exam note: Elastic IPs are FREE when attached to a running
        # instance, CHARGED when unattached. But an EIP on an instance behind
        # an ALB is a security anti-pattern — it bypasses the ALB and exposes
        # the instance to direct port scanning.

        # ------------------------------------------------------------------
        # 5. Application Load Balancer
        # ------------------------------------------------------------------
        # DOP-C02 exam note: ALB operates at Layer 7 (HTTP/HTTPS). It can
        # route based on path, host header, HTTP method, query string, and
        # source IP. NLB operates at Layer 4 (TCP/UDP) — faster but no
        # content-based routing. CLB is legacy — don't use for new projects.
        #
        # TEMPORARY: This ALB exists for CodeDeploy traffic hook practice.
        # Remove it after exam prep to save ~$16.50/month.

        # Security note: Production would add AWS WAF WebACL here for
        # OWASP protection (AWSManagedRulesCommonRuleSet). HSTS headers
        # should be set in Next.js next.config.mjs headers config.
        # Skipped for exam practice to keep costs at $0.
        alb = elbv2.ApplicationLoadBalancer(
            self, "Alb",
            vpc=vpc,
            internet_facing=True,
            security_group=alb_sg,
            load_balancer_name="casa-coqui-alb",
        )

        # Security note: ALB→EC2 traffic is plaintext HTTP within the VPC.
        # Acceptable for non-PCI/HIPAA workloads on AWS internal network.
        # For end-to-end encryption, configure Next.js with TLS and set
        # protocol to HTTPS here.
        #
        # Target group — where the ALB sends traffic.
        # DOP-C02 exam note: Health checks are configured on the TARGET GROUP,
        # not on the ALB or the instance. The deregistration_delay controls how
        # long the ALB waits for in-flight requests to complete before removing
        # an instance. CodeDeploy waits for deregistration to finish before
        # firing the AfterBlockTraffic hook.
        target_group = elbv2.ApplicationTargetGroup(
            self, "TargetGroup",
            vpc=vpc,
            port=3000,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_type=elbv2.TargetType.INSTANCE,
            health_check=elbv2.HealthCheck(
                path="/",
                port="3000",
                healthy_http_codes="200",
                interval=Duration.seconds(30),
                timeout=Duration.seconds(10),
                healthy_threshold_count=2,
                unhealthy_threshold_count=3,
            ),
            # Lower deregistration delay for faster deploys during practice.
            # Default is 300 seconds. 30 seconds is enough for our traffic.
            deregistration_delay=Duration.seconds(30),
        )

        # Register the EC2 instance with the target group.
        target_group.add_target(
            elbv2_targets.InstanceIdTarget(instance.instance_id, port=3000)
        )

        # HTTPS listener — terminates SSL at the ALB.
        alb.add_listener(
            "HttpsListener",
            port=443,
            certificates=[certificate],
            default_target_groups=[target_group],
        )

        # HTTP listener — redirects to HTTPS.
        # DOP-C02 exam note: This is the standard pattern. ALB can do the
        # redirect natively — no need for Nginx or app-level redirect logic.
        alb.add_listener(
            "HttpListener",
            port=80,
            default_action=elbv2.ListenerAction.redirect(
                protocol="HTTPS",
                port="443",
                permanent=True,
            ),
        )

        # ------------------------------------------------------------------
        # 6. CodeDeploy
        # ------------------------------------------------------------------

        # CodeDeploy service role — allows CodeDeploy to talk to EC2 and ALB.
        # DOP-C02 exam note: This is a SERVICE role (assumed by CodeDeploy),
        # NOT the same as the EC2 instance role. Two separate roles with
        # different trust policies:
        #   - EC2 role: trusted by ec2.amazonaws.com
        #   - CodeDeploy role: trusted by codedeploy.amazonaws.com
        codedeploy_role = iam.Role(
            self, "CodeDeployRole",
            assumed_by=iam.ServicePrincipal("codedeploy.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSCodeDeployRole"
                ),
            ],
        )

        # CodeDeploy application — logical container for deployment groups.
        application = codedeploy.ServerApplication(
            self, "CodeDeployApp",
            application_name="casa-coqui",
        )

        # CloudWatch alarm for unhealthy targets — TEMPORARILY DISABLED.
        # Re-enable after first successful deployment gets the app running.
        # unhealthy_hosts_alarm = cloudwatch.Alarm(
        #     self, "UnhealthyHostsAlarm",
        #     metric=target_group.metric_unhealthy_host_count(),
        #     threshold=1,
        #     evaluation_periods=1,
        #     alarm_name="casa-coqui-unhealthy-hosts",
        #     alarm_description="Triggers CodeDeploy rollback if target becomes unhealthy during deployment",
        #     treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        # )

        # Deployment group — ties together: which instances, what strategy,
        # which load balancer, and rollback settings.
        # DOP-C02 exam note: The deployment group is where you configure:
        #   - Tag filters (which EC2 instances to deploy to)
        #   - Deployment config (AllAtOnce, HalfAtATime, OneAtATime)
        #   - ALB association (enables traffic hooks)
        #   - Auto-rollback triggers (deployment failure, CloudWatch alarm)
        deployment_group = codedeploy.ServerDeploymentGroup(
            self, "DeploymentGroup",
            application=application,
            deployment_group_name="casa-coqui-production",
            role=codedeploy_role,
            ec2_instance_tags=codedeploy.InstanceTagSet({
                "Application": ["casa-coqui"],
            }),
            # AllAtOnce is fine for single instance. HalfAtATime and
            # OneAtATime only matter with multiple instances.
            deployment_config=codedeploy.ServerDeploymentConfig.ALL_AT_ONCE,
            # Associate with ALB target group — this ENABLES the traffic hooks
            # (BeforeBlockTraffic, AfterBlockTraffic, BeforeAllowTraffic,
            # AfterAllowTraffic). Without this, those hooks are skipped.
            load_balancers=[codedeploy.LoadBalancer.application(target_group)],
            # Auto-rollback on deployment failure.
            # DOP-C02 exam note: When enabled, a failed deployment triggers a
            # NEW deployment of the last known good revision. Rollback = redeploy,
            # NOT snapshot restore. All hooks run again during rollback.
            auto_rollback=codedeploy.AutoRollbackConfig(
                failed_deployment=True,
                # deployment_in_alarm=True,  # Re-enable with alarm after first deploy
            ),
            # alarms=[unhealthy_hosts_alarm],  # Re-enable after first deploy
        )

        # ------------------------------------------------------------------
        # 7. Route53 A Record
        # ------------------------------------------------------------------
        # Points dev.casa-coqui.cc → ALB DNS name (alias record).
        # Using a subdomain so production (casa-coqui.cc on Vercel) is untouched.
        # DOP-C02 exam note: Alias records are AWS-specific Route53 feature.
        # They work like CNAME but can be used at the zone apex (naked domain).
        # No charge for alias queries to AWS resources (ALB, CloudFront, S3).
        route53.ARecord(
            self, "DnsRecord",
            zone=hosted_zone,
            record_name="dev.casa-coqui.cc",
            target=route53.RecordTarget.from_alias(
                route53_targets.LoadBalancerTarget(alb)
            ),
        )

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(self, "InstanceId", value=instance.instance_id)
        CfnOutput(self, "AlbDns", value=alb.load_balancer_dns_name)
        CfnOutput(self, "AppUrl", value="https://dev.casa-coqui.cc")
        CfnOutput(
            self, "SsmConnect",
            value=f"aws ssm start-session --target {instance.instance_id}",
            description="Connect to EC2 via Session Manager (no SSH key needed)",
        )
        CfnOutput(
            self, "CodeDeployAppName",
            value=application.application_name,
            description="CodeDeploy application name for deployments",
        )
