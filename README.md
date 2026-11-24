# TaskFlow DevOps Automation Platform

**Capstone project** - Deepanshu Negi, Roll No. 2301350026, B.Tech (Full Stack)

An end-to-end DevOps platform for a sample REST application (`taskflow-api`). It automates the
software delivery lifecycle from commit to production: version control, automated tests, secret and
vulnerability scanning, container build with SBOM and signing, Kubernetes deployment with a canary
release and automatic rollback, infrastructure as code, metrics, alerting, centralized logs, and
recoverability controls.

The full report (problem, architecture, implementation evidence, testing, results, conclusions) is in
[docs/Capstone_Report.pdf](docs/Capstone_Report.pdf).

## Repository layout

| Path | Purpose |
|---|---|
| `app/` | Node.js (Express) API, unit tests (`node:test`), Dockerfile |
| `.github/workflows/ci-cd.yml` | Pipeline: test, gitleaks, build, Trivy gate, SBOM, push, cosign, staging, canary, promote |
| `k8s/base/` | Namespace, Deployment (hardened), Service, Ingress, HPA, PDB, NetworkPolicy |
| `k8s/overlays/staging`, `canary`, `production` | Environment and release-strategy overlays |
| `infra/terraform/` | Cloud infrastructure: ECR (immutable tags, scan on push), versioned encrypted backup bucket |
| `monitoring/` | Prometheus scrape config, SLO alert rules, Grafana datasources, dashboard as code |
| `logging/` | Loki (14-day retention) and Promtail configuration for JSON logs |
| `docker-compose.yml` | Runs the app, Prometheus, Loki, Promtail, Grafana locally |
| `scripts/` | Smoke test, manifest validation |
| `docs/evidence/` | Captured logs, metrics, and smoke-test output from a real run |

## Architecture

```
 git push -> GitHub Actions
     test (lint, unit) -> gitleaks -> build image -> Trivy (fail on HIGH/CRITICAL)
     -> SBOM (SPDX) -> push to GHCR by digest -> cosign keyless signature
     -> staging deploy + smoke test
     -> production: canary (1 pod ~10%) -> 5 min observe 5xx rate -> promote OR rollback
 Kubernetes: Ingress (TLS) -> Service -> taskflow-api pods (non-root, read-only FS, NetworkPolicy)
 Observability: app /metrics -> Prometheus -> alerts + Grafana; JSON logs -> Promtail -> Loki -> Grafana
```

## Run locally (no cluster needed)

Prerequisites: Node.js 20+, Docker (optional, for compose).

```bash
# 1. Tests and lint
cd app && npm ci && npm run lint && npm test && cd ..

# 2. Run the API
cd app && PORT=8080 node src/server.js        # in another terminal:
scripts/smoke-test.sh http://localhost:8080

# 3. Full local stack with monitoring (Docker)
echo "GRAFANA_ADMIN_PASSWORD=change-me" > .env
docker compose up --build
# Grafana http://localhost:3000  Prometheus http://localhost:9090  API http://localhost:8080/api/tasks

# 4. Validate Kubernetes and pipeline files offline
pip install pyyaml && scripts/validate-manifests.sh
```

## Deploy to Kubernetes

```bash
# Infrastructure (requires AWS credentials; copy the example vars first)
cd infra/terraform && cp terraform.example.tfvars terraform.tfvars
terraform init && terraform plan && terraform apply

# Application
kubectl apply -k k8s/overlays/staging
kubectl -n taskflow rollout status deploy/taskflow-api
```

Production releases run through the pipeline: the `production` GitHub environment requires a manual
approval, then the canary runs. Required secrets: `KUBECONFIG_STAGING`, `KUBECONFIG_PROD` (base64).

## Security controls

- Secret scanning on every push (gitleaks); no credentials in the repository.
- Container: multi-stage build, non-root user, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, `HEALTHCHECK`, `x-powered-by` removed, request body limit (10 KB), JSON-only error handler (no stack traces).
- Image: Trivy gate on HIGH/CRITICAL, SPDX SBOM, build provenance, keyless cosign signature, immutable ECR tags.
- Kubernetes: Pod Security `restricted` namespace label, `RuntimeDefault` seccomp, no service-account token mount,
  NetworkPolicy allowing traffic only from the ingress controller and monitoring namespace, rate limit at ingress.
- Pipeline: least-privilege `GITHUB_TOKEN` permissions, environment protection with approval for production.

## Reliability and recoverability

- Rolling updates with `maxUnavailable: 0`, readiness/liveness/startup probes, `preStop` drain, graceful SIGTERM handling.
- HPA (3-10 replicas, 70% CPU), PodDisruptionBudget (`minAvailable: 2`), topology spread across nodes.
- Canary with automatic rollback on 5xx rate above 5%.
- Rollback: `kubectl -n taskflow rollout undo deploy/taskflow-api`. Image tags are immutable, so any previous digest can be redeployed.
- Terraform state and backups: versioned, encrypted, private S3 bucket.

## Monitoring and alerts

Dashboard "TaskFlow API - Service Health" (`monitoring/grafana/dashboards/taskflow.json`) shows request
rate, 5xx ratio, p95 latency, stored tasks, status breakdown, memory, and live logs. Alerts
(`monitoring/prometheus/alerts.yml`): high error rate (SLO 1%), p95 latency, target down, canary errors.

## Testing

- Unit and API tests: 7 tests covering probes, validation, CRUD, malformed input, metrics, and header hardening (`npm test`).
- Smoke test against a running instance (`scripts/smoke-test.sh`). Output: [docs/evidence/sample-logs/smoke-test.txt](docs/evidence/sample-logs/smoke-test.txt).
- Manifest validation (`scripts/validate-manifests.sh`).

## Sample data and logs

`docs/evidence/sample-logs/` contains the real structured log output (`app-run.log`), the metrics
snapshot after the smoke test, and response headers.

## Known limitations

- Task data is held in memory (the sample app). A production version would use a managed database with backups.
- The Kubernetes and Terraform files were validated for syntax and structure, not applied to a live cluster in this submission.
  Placeholder values (`taskflow.example.com`, kubeconfig secrets, AWS region) must be set for a real deployment.
- Docker and kubectl were not available on the build machine, so the compose stack and cluster rollout are documented but not executed here.
