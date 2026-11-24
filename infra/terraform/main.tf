# Infrastructure as code for the taskflow platform.
# Provisions a managed Kubernetes cluster, a container registry, and the namespaces
# that the Kubernetes manifests expect. Remote state is recommended (see backend.tf comment).
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.31" }
  }
  # backend "s3" { bucket = "taskflow-tfstate", key = "platform/terraform.tfstate", region = "ap-south-1", encrypt = true }
}

variable "region" { default = "ap-south-1" }
variable "cluster_name" { default = "taskflow-prod" }
variable "node_count" { default = 3 }

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "taskflow", owner = "2301350026", managed_by = "terraform" }
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "taskflow-api"
  image_tag_mutability = "IMMUTABLE"          # tags cannot be overwritten
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "KMS" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_s3_bucket" "backups" {
  bucket = "taskflow-backups-${var.cluster_name}"
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "ecr_repository_url" { value = aws_ecr_repository.api.repository_url }
output "backup_bucket" { value = aws_s3_bucket.backups.bucket }
