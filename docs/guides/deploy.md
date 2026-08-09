# Deploying to AWS

The whole environment is described by `sst.config.ts` and the two files in
`infra/`, so bringing it up is one command and taking it down is one command.
This guide is the second half of that promise: the things a command cannot
carry, which are what the environment costs, how to migrate it, how to check it
is actually working, and when to remove it again.

The architecture and the reasoning behind it are in
[ADR-0014](../adrs/backend/0014-aws-hosting-layout.md) and
[ADR-0015](../adrs/backend/0015-sst-infrastructure-as-code.md). This guide
assumes both and does not repeat them.

## Prerequisites

* Docker running locally. The container image is built on the deploying
  machine and pushed to ECR, so a stopped Docker daemon fails the deploy with
  `Cannot connect to the Docker daemon`, and it fails after several minutes of
  other work rather than immediately.
* Node.js 24 LTS, the version in `.node-version`, same as
  [local setup](local-setup.md).
* An AWS account with a deploy identity and a budget alarm. Those are made once
  and are not part of a deploy, so they live in
  [AWS account setup](aws-account-setup.md).

## Getting a credential

The account and the identity are set up once. Every session after that needs
one line:

```sh
aws sso login --profile kanso
```

The credential expires on its own, which is the point of using IAM Identity
Center rather than a long-lived access key. When it expires, SST fails with an
expired-token error and the same command fixes it.

The permission set the deploy identity uses today is `AdministratorAccess`. It
is wider than the deploy needs, and narrowing it is worth doing from evidence
rather than from guesswork: CloudTrail records every call a deploy actually
made, so a later pass can read the real list off a completed deploy instead of
assembling a policy by imagination and discovering the gaps one failure at a
time. What the first deploy is known to have touched is EC2 for the VPC and the
security groups, RDS, ECR, ECS, ELBv2, IAM for the task roles, Secrets Manager,
CloudWatch Logs, ACM, and S3 and SSM for SST's own state.

## The budget alarm

An account-level control, set once per account rather than once per deploy, so
the command lives in [AWS account setup](aws-account-setup.md) rather than
here. It has to exist before the first deploy. An environment that is meant to
spend most of its life torn down is exactly the kind that gets left up.

## What gets created, and what it costs

Per month, at list price for `ap-south-2`, with the stage up the whole month:

| Resource | Monthly |
| --- | --- |
| VPC, two public and two private subnets, no NAT gateway | $0 |
| RDS `db.t4g.micro`, single AZ, 20 GB gp3 | about $17 |
| ECS Fargate, one task at 0.25 vCPU and 0.5 GB | about $10 |
| Application load balancer | about $17 |
| Secrets Manager secret for the database credential | $0.40 |
| ECR repository holding the image | about $0.05 |
| **Total** | **about $45** |

Two notes on that table. The first is that these are list prices rather than a
bill: the stage this guide was written from lived for hours, not a month, so
nothing here has been read off a statement yet. The second is that there is
deliberately no NAT gateway. One would add about $32 a month on its own, which
is more than the database, and the service does not need one because its tasks
run with a public IP and reach the internet directly while the database stays
private.

The total is why the teardown section below is a first-class step rather than a
footnote.

## Bring it up

```sh
npx sst deploy --stage dev
```

The first deploy takes about ten minutes, and almost all of it is two
resources: the RDS instance takes around nine minutes and the load balancer
around three. Later deploys that only change application code take about a
minute, because the image layers are cached in ECR and nothing else has to be
replaced.

The stage name is ours to choose. `production` is special: `sst.config.ts` sets
`removal: 'retain'` and `protect: true` for it, so a mistyped remove command
cannot take the database with it. Every other stage is fully removable, because
a personal stage nobody deletes is a bill nobody notices.

## Migrate it

The database is not reachable from a laptop, on purpose. It has no public
address and its security group only accepts traffic from inside the VPC, so
`sst shell` cannot run the migrator: the shell runs locally with the stage's
environment variables, not inside the network.

The way in is a one-off task on the same cluster, overriding the container
command:

```sh
CLUSTER=$(aws ecs list-clusters --query 'clusterArns[0]' --output text)
TASK_DEF=$(aws ecs list-task-definitions --family-prefix kanso --sort DESC \
  --query 'taskDefinitionArns[0]' --output text)
NET=$(aws ecs describe-services --cluster "$CLUSTER" \
  --services $(aws ecs list-services --cluster "$CLUSTER" \
    --query 'serviceArns[0]' --output text) \
  --query 'services[0].networkConfiguration.awsvpcConfiguration')

aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration=$NET" \
  --overrides '{"containerOverrides":[{"name":"Api","command":["node","src/db/migrate.ts"]}]}'
```

It runs the same `apps/api/src/db/migrate.ts` the integration tests run, gets
`DATABASE_URL` from the same task definition the service uses, and exits. The
proof it worked is one line in the task's CloudWatch log stream:

```
Migrations applied.
```

The alternative would have been to give the database a public address for the
length of a migration. That trades a permanent weakness for a temporary
convenience, and the one-off task costs a few cents of Fargate time.

## Prove it

Once the DNS records below exist, the check is one line:

```sh
curl https://dev.api.kansochess.app/health
```

Expected: `{"status":"ok","database":"ok"}`. That single response proves more
than it looks like: a valid certificate at the edge, Cloudflare reaching the
load balancer, the load balancer reaching the task, and the task reaching the
private database, because `/health` answers 200 only after a `select 1` returns.

Before those records exist, or any time the public path is in doubt and the
question is whether the application itself is healthy, the same checks run from
inside the VPC as another one-off task with a command override, pointed at the
running task's private address:

```sh
TASK_IP=$(aws ecs describe-tasks --cluster "$CLUSTER" \
  --tasks $(aws ecs list-tasks --cluster "$CLUSTER" --query 'taskArns[0]' --output text) \
  --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' \
  --output text)
```

Then run a task whose command fetches `http://$TASK_IP:3000/health` and
`http://$TASK_IP:3000/me`. What came back the first time:

```
PROBE /health -> 200 {"status":"ok","database":"ok"}
PROBE /me -> 401 {"code":"no_session","message":"Sign in to use this endpoint."}
```

The first line is the whole path working: `/health` answers 200 only after a
`select 1` reaches RDS, so a 200 is the deployed container talking to the
private database. The second is the session guard doing its job on a real
endpoint, which is the correct answer for a request with no cookie.

There is a second, independent version of the same proof that needs no command
at all. The load balancer's target group health check calls `/health` every 30
seconds, so a target reporting `healthy` is AWS itself confirming the
application and the database are connected:

```sh
aws elbv2 describe-target-health --target-group-arn \
  $(aws elbv2 describe-target-groups --query 'TargetGroups[0].TargetGroupArn' --output text)
```

## HTTPS and DNS

`kansochess.app` is on Cloudflare, so Cloudflare is the public edge and there is
no CloudFront distribution in this stack. Requests arrive at Cloudflare over
HTTPS on Cloudflare's own certificate, and Cloudflare forwards them to the load
balancer over HTTPS on an ACM certificate for the same hostname. Both legs are
encrypted, and the Cloudflare SSL/TLS mode for the zone must be **Full
(strict)**, which is what makes Cloudflare actually check the second
certificate rather than accept anything.

The load balancer's security group accepts port 443 from Cloudflare's published
address ranges and nothing else. `infra/api.ts` reads those ranges from
Cloudflare's API at deploy time rather than keeping a pasted copy, because the
list changes and a stale copy fails closed: the load balancer would start
refusing the edge it exists to serve.

The hostname is `api.kansochess.app` on the `production` stage and
`<stage>.api.kansochess.app` everywhere else, so a second stage never collides
with the first.

### The certificate

One ACM certificate in `ap-south-2` covers `api.kansochess.app` and
`*.api.kansochess.app`, which is every stage we will ever have. It was
requested once by hand and it renews itself:

```sh
aws acm request-certificate --domain-name api.kansochess.app \
  --subject-alternative-names '*.api.kansochess.app' --validation-method DNS
```

SST would normally create and validate this itself, but it can only do that for
a domain whose DNS it controls. Ours is on Cloudflare and this repository holds
no Cloudflare token, so `infra/api.ts` passes `dns: false` and the certificate
ARN instead, and the records below are added by hand.

### The two DNS records

Both live in the Cloudflare dashboard for `kansochess.app`. They are added once
and they survive every teardown, because neither of them names anything a
teardown deletes.

The **validation record** proves we own the domain, and ACM re-checks it at
every renewal, so it stays forever. Its exact name and value come from:

```sh
aws acm describe-certificate --certificate-arn <arn> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

It is a `CNAME`, and it must be **DNS only** in Cloudflare, the grey cloud. A
proxied validation record does not resolve to what ACM is looking for and the
certificate never leaves `PENDING_VALIDATION`.

The **service record** points the hostname at the load balancer. Its value is
the load balancer's DNS name, which only exists after the first deploy:

```sh
aws elbv2 describe-load-balancers --query 'LoadBalancers[0].DNSName' --output text
```

It is a `CNAME` and it must be **Proxied**, the orange cloud. That is what puts
Cloudflare in front, and it is also what makes the security group rule above
correct: unproxied, requests would come from the whole internet and the load
balancer would refuse them.

This means the very first deploy of a stage has a gap between the load balancer
existing and the record pointing at it. Later deploys reuse the same load
balancer name, so the record keeps working. A teardown and rebuild produces a
new name and the service record has to be updated.

## Tear it down

```sh
npx sst remove --stage dev
```

That deletes everything the stage created: the VPC, the database and its data,
the cluster and the running task, the load balancer, and the ECR image. It
takes about six minutes, most of it the database and the VPC. The bill for the
stage stops when the remove finishes. On `production` the `removal: 'retain'`
setting keeps the database behind, deliberately, so the same command cannot
destroy real data.

Two account-level things survive on purpose, because they are shared by every
stage rather than owned by one: the `sst-asset` ECR repository, now empty, and
the S3 bucket holding SST's deploy state. Neither costs anything measurable
when no stage is up. Worth checking afterwards that nothing else did:

```sh
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName'
aws ecs list-clusters --query 'clusterArns'
```

All three should come back empty. Those are the three that cost real money.

Tearing down between measurements is the intended way to use this, not a
cleanup afterthought. The environment costs about $45 a month while it is up,
nothing but ST-008's cost measurement needs it up, and everything about it is in
the repository, so bringing it back is the same ten minutes every time.

## Secrets

No credential for a deployed stage is ever written into a file. Not into
`.env`, not into the image, not into the repository.

The RDS password is generated by SST and stored in AWS. `DATABASE_URL` is
assembled in `infra/api.ts` from the database component's own outputs with
`$interpolate`, which means the value is resolved at deploy time and lands in
the ECS task definition rather than anywhere a person handles. What is in the
repository is the template, with no literal values in it.

`.env` stays gitignored and stays local, and the connection string in it points
at the local PostgreSQL container from [local setup](local-setup.md). The
pre-commit hook runs gitleaks, so a real connection string cannot reach a commit
even by accident.

## What is deliberately not here yet

* **The queue and the analysis worker.** ST-007 adds them. Adding the
  components now would mean paying for and reasoning about infrastructure no
  code uses.
* **RDS Proxy.** ADR-0014 defers it until connection counts justify it. One
  Fargate task with a pool of ten connections does not.
* **Cloudflare DNS managed by SST.** A token scoped to `Zone:DNS:Edit` on this
  one zone would let SST create and remove the service record on every deploy,
  which is the only manual step left in a rebuild. It is not here because a
  token is a credential to store and rotate, and the step it removes is one
  record edit per teardown. Worth revisiting if teardowns become frequent.
* **Separate accounts per environment, and a narrower deploy permission set.**
  Both are recorded in [AWS account setup](aws-account-setup.md) as things a
  one-person project does not need on day one.
