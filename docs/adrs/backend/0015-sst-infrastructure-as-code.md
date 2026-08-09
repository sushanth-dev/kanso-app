# 0015. Define AWS infrastructure with SST

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0014](0014-aws-hosting-layout.md)

## Context

ADR-0014 commits us to a set of AWS resources: an always-on API service,
an SQS queue, Lambda functions, RDS PostgreSQL, a load balancer, and
secrets in a manager. Those have to be provisioned and kept in code, and
the tool choice is expensive to reverse once the layout exists. The
alternatives were AWS CDK, Terraform or OpenTofu, Pulumi, and SST.

The team is small and TypeScript-native, and the app is exactly the shape
some tools are built for: a Node service plus serverless functions. That
argues against context-switching to HCL (Terraform, OpenTofu) and against
CDK's bootstrap-plus-CloudFormation-synthesis weight for a project this
size.

## Decision

Use SST. Version 3 was the current line when this record was written; ST-006
deploys on version 4, which is the same Pulumi engine and the same Terraform
providers under the same components, so the reasoning below is unchanged and
only the number moved. SST is
TypeScript-first and built for this shape: it models the API, the queue,
the functions, and the database as code in the same language as the app,
and it handles state without a separate hosted backend to sign up for. It
sits on Pulumi's engine and Terraform's providers, so it is a layer over
maintained machinery rather than a from-scratch bet, and it needs no
Pulumi account.

Two qualifications come with the choice. SST is a smaller vendor than AWS
or HashiCorp, so its longevity is a real risk we accept for the fit; the
exit is that the underlying providers are standard, so the resources are
not locked to SST's model. And SST's live-reload dev mode is a convenience
we will use but not depend on, since the app must run and test locally
without it.

## Consequences

One new dev dependency and an `infra/` tree written in TypeScript, so the
infrastructure reads in the same language as the application and is
reviewed the same way. Terraform's HCL context-switch and CDK's bootstrap
ceremony are avoided. The accepted risk is vendor size: if SST stalls, the
migration path is to CDK or Terraform over the same AWS resources, and
that path is recorded here rather than discovered later. Secrets stay in
AWS Secrets Manager, referenced from the SST config, never committed.
