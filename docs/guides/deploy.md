# Deploying to AWS

The whole environment is described by `sst.config.ts` and the files in
`infra/`, so bringing it up is one command and taking it down is one command.
This guide is the second half of that promise: the things a command cannot
carry, which are what the environment costs, how to migrate it, how to check it
is actually working, and when to remove it again.

The architecture and the reasoning behind it are in
[ADR-0014](../adrs/backend/0014-aws-hosting-layout.md),
[ADR-0015](../adrs/backend/0015-sst-infrastructure-as-code.md), and
[ADR-0033](../adrs/backend/0033-lambda-api-http-api.md). This guide assumes
them and does not repeat them.

## Prerequisites

* Docker running locally. The analysis image is a container built on the
  deploying machine and pushed to ECR, so a stopped Docker daemon fails the
  deploy with `Cannot connect to the Docker daemon`, and it fails after several
  minutes of other work rather than immediately.
* Node.js 24 LTS, the version in `.node-version`, same as
  [local setup](local-setup.md).
* An AWS account with a deploy identity and a budget alarm. Those are made once
  and are not part of a deploy, so they live in
  [AWS account setup](aws-account-setup.md).
* A scoped Cloudflare API token and account ID in `.env`, for the web deploy.
  The token is Workers Scripts (Edit) on the account, and Zone (Read) on the
  `kansochess.app` zone. The custom-domain step auto-creates the web record, so
  no DNS permission is needed.

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
time. What the first deploy is known to have touched is EC2 for the VPC, the NAT
instances, and the security groups, RDS, ECR, Lambda, API Gateway, IAM
for the function roles, Secrets Manager, CloudWatch Logs, ACM, and S3 and SSM
for SST's own state.

## The budget alarm

An account-level control, set once per account rather than once per deploy, so
the command lives in [AWS account setup](aws-account-setup.md) rather than
here. It has to exist before the first deploy. An environment that is meant to
spend most of its life torn down is exactly the kind that gets left up. The
threshold is $80 monthly with an alert at half of it, so one deliberate stage
at about $24 sits under the alert while a second forgotten stage trips it.

## What gets created, and what it costs

Per month, at list price for `ap-south-2`, with the stage up the whole month:

| Resource | Monthly |
| --- | --- |
| VPC, two public and two private subnets, with two NAT instances | about $6 |
| RDS `db.t4g.micro`, single AZ, 20 GB gp3 | about $17 |
| Lambda and API Gateway HTTP API | about $0 at this traffic |
| Secrets Manager secret for the database credential | $0.40 |
| ECR repository holding the analysis image | about $0.05 |
| **Total** | **about $24** |

Two notes on that table. The first is that these are list prices rather than a
bill: the stage this guide was written from lived for hours, not a month, so
nothing here has been read off a statement yet. The second is that the NAT is a
pair of `t4g.nano` instances, not a managed gateway. A Lambda cannot take a
public IP the way the Fargate task did, so it reaches the internet through a
NAT from the private subnets. Two instances cost about $6 a month; the managed
gateway would be about $64, which is more than the database. The single point
of failure an instance is per zone is a launch concern, not a deployment one.

The web half does not appear in the table because Cloudflare serves static
assets inside its free tier. It does add one credential: a scoped
`CLOUDFLARE_API_TOKEN` in `.env` for the Worker deploy, whose exact scope the
prerequisites name.

The total is why the teardown section below is a first-class step rather than a
footnote.

## Build the analysis image

The analysis worker is a Lambda container image, because the engine is a native
binary compiled for arm64 (ADR-0023). SST bundles the API's function itself;
this one is built and pushed by hand, and the function is pointed at the tag:

```sh
TAG=$(git rev-parse --short HEAD)
REPO=$(aws ecr describe-repositories --query \
  "repositories[?contains(repositoryName, 'analysisrepository')].repositoryUri" --output text)

aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 --provenance=false --sbom=false \
  --output "type=image,name=$REPO:$TAG,push=true,oci-mediatypes=false" \
  -f apps/api/Dockerfile.analysis .

export ANALYSIS_IMAGE_TAG=$TAG
```

The flags are not decoration. With Docker 29's containerd image store, a plain
`docker buildx build --push` writes an OCI image index
(`application/vnd.oci.image.index.v1+json`) whose build-attestation entries
Lambda refuses: `UpdateFunctionCode` fails with "The image manifest, config or
layer media type for the source image ... is not supported", after the rest of
the deploy has already run. The output form above pins a single
`application/vnd.docker.distribution.manifest.v2+json` manifest, which is what
the 30 August 2026 production re-deploy needed. If a deploy fails with that
error, check what ECR actually holds:

```sh
aws ecr describe-images --repository-name analysisrepository \
  --image-ids imageTag=$TAG \
  --query 'imageDetails[0].imageManifestMediaType' --output text
```

`oci.image.index` is the failure; `docker.distribution.manifest.v2` is what
Lambda accepts. Re-push the same tag with the flags and re-run `sst deploy`:
the failed deploy leaves the stack half-converged and the second run finishes
it.

The build compiles Stockfish from source, so it takes minutes rather than
seconds. Use the commit as the tag rather than `latest`: two deploys of `latest`
look identical to the deploy tool, so the function would keep running the old
image while reporting success.

The repository is created by the first `sst deploy`, so on a brand new stage
deploy once, then build and push, then deploy again with `ANALYSIS_IMAGE_TAG`
set.

The `production` stage is live as of 26 August 2026 at `kansochess.app` and
`api.kansochess.app` (ST-081). A re-deploy of it is the same command with
`--stage production` and `ANALYSIS_IMAGE_TAG` set to the commit the analysis
image was built from.

The deploy also uploads the web bundle to a Cloudflare Worker, which needs the
scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_DEFAULT_ACCOUNT_ID` in `.env`.

The first deploy of a stage took 11 minutes 13 seconds when the API ran on
Fargate, and almost all of it was two resources: the RDS instance took 8 minutes
48 seconds and the load balancer 2 minutes 51 seconds. The Lambda re-host is
shorter, because the load balancer is gone; the exact time is re-measured after
the next deploy rather than guessed.

The stage name is ours to choose. `production` is special: `sst.config.ts` sets
`removal: 'retain'` and `protect: true` for it, so a mistyped remove command
cannot take the database with it. Every other stage is fully removable, because
a personal stage nobody deletes is a bill nobody notices.

## Migrate it

The database is not reachable from a laptop, on purpose. It has no public
address and its security group only accepts traffic from inside the VPC, so
`sst shell` cannot run the migrator: the shell runs locally with the stage's
environment variables, not inside the network.

The way in is the `Migrate` Lambda, which `infra/api.ts` deploys in the same
VPC as the database. It runs the checked-in migrator and exits:

```sh
MIGRATE=$(aws lambda list-functions --query \
  "Functions[?starts_with(FunctionName, 'kanso-dev-Migrate')].FunctionName | [0]" \
  --output text)
aws lambda invoke --function-name "$MIGRATE" --payload '{}' /tmp/migrate.out
cat /tmp/migrate.out
```

It runs the same `apps/api/src/db/migrate.ts` the integration tests run, gets
`DATABASE_URL` from the same function configuration the API uses, and exits.
The proof it worked is the response payload:

```
"Migrations applied."
```

The alternative would have been to give the database a public address for the
length of a migration. That trades a permanent weakness for a temporary
convenience, and the Lambda invocation costs a few cents of Lambda time.

## Prove it

Once the DNS records below exist, the check is one line:

```sh
curl https://dev-api.kansochess.app/health
```

Expected, and what came back:

```
{"status":"ok","database":"ok"}
```

That single response proves more than it looks like: a valid certificate at the
edge, Cloudflare reaching API Gateway, API Gateway reaching the function, and
the function reaching the private database, because `/health` answers 200 only
after a `select 1` returns.

Two more that are worth running once per stage. The session guard, live on a
real endpoint, where 401 is the correct answer to a request with no cookie:

```
$ curl https://dev-api.kansochess.app/me
{"code":"no_session","message":"Sign in to use this endpoint."}
```

And the negative one, which is the only check that proves the origin is not
quietly reachable around Cloudflare:

```sh
API_ID=$(aws apigatewayv2 get-apis --query 'Items[0].ApiId' --output text)
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://$API_ID.execute-api.ap-south-2.amazonaws.com/health"
```

Expected is a refusal, not the API. The guide first recorded `403`; the 30
August 2026 re-deploy observed `{"message":"Not Found"}`, HTTP 404, from the
same disabled endpoint. Whichever refusal AWS serves, the property the check
proves is the same: nothing is routed on the `execute-api` name, so the custom
domain behind Cloudflare is the only public entry. If it answers `200`, the
endpoint was not disabled and every control Cloudflare applies can be skipped
by anyone who learns the API id.

## HTTPS and DNS

`kansochess.app` is on Cloudflare, so Cloudflare is the public edge and there is
no CloudFront distribution in this stack. Requests arrive at Cloudflare over
HTTPS on Cloudflare's own certificate, and Cloudflare forwards them to API
Gateway over HTTPS on an ACM certificate for the same hostname. Both legs are
encrypted, and the Cloudflare SSL/TLS mode for the zone must be **Full
(strict)**, which is what makes Cloudflare actually check the second
certificate rather than accept anything.

`infra/api.ts` sets `disableExecuteApiEndpoint` on the HTTP API, so the default
`execute-api` URL is refused and the custom domain behind Cloudflare is the only
public entry. An HTTP API cannot take a WAF Web ACL, so the endpoint is closed at
the source instead of filtered by address range.

The hostname is `api.kansochess.app` on the `production` stage and
`<stage>-api.kansochess.app` everywhere else, so a second stage never collides
with the first.

That hyphen is not a style choice. The certificate Cloudflare includes with the
zone covers `kansochess.app` and `*.kansochess.app` and stops there, so a name
two levels deep has nothing to present at the edge. `dev.api.kansochess.app` was
tried first and every request failed the TLS handshake before reaching any of
our infrastructure:

```
curl: (35) error:1404B410:SSL routines:ST_CONNECT:sslv3 alert handshake failure
```

Covering deeper names needs Cloudflare's Advanced Certificate Manager at about
$10 a month, which is a quarter of what this whole environment costs, for a dot.

### The certificate

One ACM certificate in `ap-south-2` for `*.kansochess.app`, which covers
`api.kansochess.app` and every stage name beside it. It was requested once by
hand and it renews itself:

```sh
aws acm request-certificate --domain-name '*.kansochess.app' \
  --validation-method DNS
```

SST would normally create and validate this itself, but it can only do that for
a domain whose DNS it controls. Ours is on Cloudflare and this repository holds
no Cloudflare token, so `infra/api.ts` passes `dns: false` and the certificate
ARN instead, and the records below are added by hand.

### The DNS records

The API's two records live in the Cloudflare dashboard for `kansochess.app`.
They are added once by hand and they survive every teardown, because neither of
them names anything a teardown deletes.

The **validation record** proves we own the domain, and ACM re-checks it at
every renewal, so it stays forever. Its exact name and value come from:

```sh
aws acm describe-certificate --certificate-arn <arn> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

It is a `CNAME`, and it must be **DNS only** in Cloudflare, the grey cloud. A
proxied validation record does not resolve to what ACM is looking for and the
certificate never leaves `PENDING_VALIDATION`. Depth is not a constraint here
the way it is for the service record: nothing ever completes a TLS handshake
against a validation record, so the one-label rule above does not apply to it.

Cloudflare appends the zone name to whatever goes in the **Name** field, so only
the part before `.kansochess.app` is typed in. Pasting the full name produces
`....kansochess.app.kansochess.app`, which validates nothing. Validation took
about three minutes once the record was live.

The **service record** points the hostname at API Gateway. Its value is the API
Gateway domain name, which only exists after the first deploy:

```sh
aws apigatewayv2 get-domain-names \
  --query 'Items[0].DomainNameConfigurations[0].ApiGatewayDomainName' --output text
```

It is a `CNAME` and it must be **Proxied**, the orange cloud. That is what puts
Cloudflare in front, which is the only reason the custom domain is reachable:
the default `execute-api` URL is disabled, so unproxied there is no direct path
to the origin.

This means the very first deploy of a stage has a gap between the API Gateway
domain existing and the record pointing at it. Later deploys reuse the same
domain name, so the record keeps working. A teardown and rebuild produces a new
name and the service record has to be updated.

The **web record** is not added by hand. The web deploys to a Cloudflare Worker,
and the custom-domain step creates the proxied record for
`dev-app.kansochess.app` itself, because the Worker and the zone live in the
same account.

## Tear it down

```sh
npx sst remove --stage dev
```

That deletes everything the stage created: the VPC, the database and its data,
the Lambda and API Gateway, the NAT instances, and the ECR image.
measured teardowns took 6 and 7 minutes 41 seconds, most of it the database and
the VPC. The bill for the stage stops when the remove finishes. On `production` the `removal: 'retain'`
setting keeps the database behind, deliberately, so the same command cannot
destroy real data.

Three account-level things survive on purpose, because they are shared by every
stage rather than owned by one: the `sst-asset` ECR repository, now empty, and
two S3 buckets, `sst-asset-*` for build artifacts and `sst-state-*` for SST's
deploy state. None costs anything measurable when no stage is up. Worth checking
afterwards that nothing else did:

```sh
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws lambda list-functions --query 'Functions[].FunctionName'
aws apigatewayv2 get-apis --query 'Items[].ApiId'
aws ec2 describe-vpcs --query 'Vpcs[?IsDefault==`false`].VpcId'
```

All four should come back empty. The first three are what cost real money; the
fourth catches a VPC left behind by a partial remove, which costs nothing on its
own but means the teardown did not finish.

Tearing down between measurements is the intended way to use this, not a
cleanup afterthought. The environment costs about $30 a month while it is up,
nothing but ST-008's cost measurement needs it up, and everything about it is in
the repository, so bringing it back is the same ten minutes every time.

## Secrets

No credential for a deployed stage is ever written into a file. Not into
`.env`, not into the image, not into the repository.

The RDS password is generated by SST and stored in AWS. `DATABASE_URL` is
assembled in `infra/api.ts` from the database component's own outputs with
`$interpolate`, which means the value is resolved at deploy time and lands in
the function configuration rather than anywhere a person handles. What is in the
repository is the template, with no literal values in it.

`.env` stays gitignored and stays local, and the connection string in it points
at the local PostgreSQL container from [local setup](local-setup.md). The
pre-commit hook runs gitleaks, so a real connection string cannot reach a commit
even by accident.

## What is deliberately not here yet

* **RDS Proxy.** ADR-0014 defers it until connection counts justify it. One
  Lambda environment with one connection does not.
* **Cloudflare DNS managed by SST.** A token scoped to `Zone:DNS:Edit` on this
  one zone would let SST create and remove the service record on every deploy,
  which is the only manual step left in a rebuild. It is not here because a
  token is a credential to store and rotate, and the step it removes is one
  record edit per teardown. Worth revisiting if teardowns become frequent.
* **Separate accounts per environment, and a narrower deploy permission set.**
  Both are recorded in [AWS account setup](aws-account-setup.md) as things a
  one-person project does not need on day one.
