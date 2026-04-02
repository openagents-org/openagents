# Deploy Workspace Backend to AWS ECS Fargate

## Prerequisites

- AWS CLI configured
- Docker installed
- An ECR repository for the image
- A PostgreSQL database (e.g., Supabase, Insforge, RDS)

## 1. Create ECR Repository

```bash
aws ecr create-repository --repository-name openagents-workspace-backend --region us-east-1
```

## 2. Build and Push Image

```bash
cd workspace/backend

aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

docker build --platform linux/amd64 -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:latest .
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:latest
```

## 3. Create ECS Resources

```bash
# Create cluster
aws ecs create-cluster --cluster-name openagents-workspace

# Create log group
aws logs create-log-group --log-group-name /ecs/openagents-workspace-backend

# Edit task-definition.json with your values, then register it
aws ecs register-task-definition --cli-input-json file://deploy/ecs/task-definition.json
```

## 4. Create Service

```bash
# Create a security group allowing port 8000 (or 443 if using ALB)
SG_ID=$(aws ec2 create-security-group \
  --group-name openagents-workspace-sg \
  --description "OpenAgents Workspace" \
  --vpc-id <VPC_ID> \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp --port 8000 --cidr 0.0.0.0/0

# Create Fargate service
aws ecs create-service \
  --cluster openagents-workspace \
  --service-name workspace-backend \
  --task-definition openagents-workspace-backend \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_1>,<SUBNET_2>],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"
```

## 5. Add HTTPS with ALB (Recommended)

For a stable URL with SSL:

1. Request an ACM certificate for your domain
2. Add DNS validation CNAME to Route 53
3. Create an ALB with HTTPS listener forwarding to a target group on port 8000
4. Update ECS service with the load balancer target group
5. Add a Route 53 A record (alias) pointing your domain to the ALB

## 6. Update Image

```bash
docker build --platform linux/amd64 -t <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:latest .
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/openagents-workspace-backend:latest
aws ecs update-service --cluster openagents-workspace --service workspace-backend --force-new-deployment
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_MODE` | No | `workspace_token` (default) or `firebase` |
| `IDENTITY_MODE` | No | `standalone` (default) or `shared` |
| `CORS_ORIGINS` | No | Allowed origins, default `*` |
| `WORKSPACE_ENDPOINT` | No | Public URL of this service (used in manifests) |
