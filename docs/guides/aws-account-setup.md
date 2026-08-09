# AWS account setup

This is the one-time setup behind everything the app runs on AWS: the account
itself, the identity we deploy with, and the spend guard that catches a mistake
before the bill does. It is done once and then never again, which is exactly why
it is written down. A step nobody has repeated in six months is a step nobody
remembers.

Deploying is a separate guide. This one stops at the point where
`aws sts get-caller-identity` answers.

## Which plan to sign up for

AWS asks for this during signup and the choice is not reversible in the
direction you would want. Since July 2025 a new account picks either the free
plan or the paid plan.

The **free plan** looks generous and carries a trapdoor. It runs for six months
or until the signup credits are spent, whichever comes first, and at the end of
it AWS does not simply start charging. It closes the account. There is a
restore window of about ninety days, and after that the data is gone
permanently. An account that closes on its own is not a cost control, it is a
way to lose a database.

Take the **paid plan**. The signup credits still apply and carry over, so it
costs the same until the credits run out, and the account keeps existing
afterwards. The thing that stops us spending money is the budget alarm below,
not a plan that deletes our infrastructure.

## Creating the account

**The root email.** Use an address we control and can still read in five years,
and one that is not shared with anyone. This address is the account. Whoever can
receive mail at it can reset the root password and take the account with it. A
plus-alias on a personal mailbox, something like `name+aws@example.com`, is fine
and makes filtering easier.

**The account name.** This is a label, not an identity, and it shows up on the
bill and in the console switcher. `kanso` is what ours is called, after the app.
It can be changed later.

**The card.** Even the free plan asks for one and takes a small verification
charge that is refunded.

**Turn on MFA for the root user immediately**, before doing anything else. The
root user can do everything, including closing the account and detaching every
guardrail, and it has no permission boundary that can be applied to it. An
authenticator app on the phone is enough.

**Then stop using root.** After this guide, the root user is used for exactly
three things: changing the billing details, closing the account, and recovering
access if the deploy identity is ever lost. Everything else, including every
deploy, uses the identity created below.

## The region

Everything lives in `ap-south-2`, Hyderabad. It is the closest region to us, and
a region is not a setting that can be flipped later: the RDS instance, its
storage, and its backups are all regional, so moving means rebuilding.

Hyderabad is a newer and smaller region than Mumbai, so it was checked rather
than assumed. It has three availability zones, ECS, ECR, and the load balancer
service all answer there, and the specific database we ask for, `db.t4g.micro`
running PostgreSQL 18, is orderable in all three zones. See
[ADR-0022](../adrs/backend/0022-postgresql-18.md) for why the PostgreSQL major
version is the thing that got checked first.

## The spend guard

Set this before creating anything, not after. The deployed environment is meant
to spend most of its life torn down, and the thing that catches a stage nobody
removed is a budget rather than a habit.

```sh
cat > /tmp/budget.json <<'JSON'
{
  "BudgetName": "kanso-monthly",
  "BudgetLimit": { "Amount": "20", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
JSON
cat > /tmp/budget-notifications.json <<'JSON'
[{
  "Notification": {
    "NotificationType": "ACTUAL",
    "ComparisonOperator": "GREATER_THAN",
    "Threshold": 50,
    "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [{ "SubscriptionType": "EMAIL", "Address": "REPLACE_WITH_EMAIL" }]
}]
JSON
aws budgets create-budget --profile kanso \
  --account-id "$(aws sts get-caller-identity --profile kanso --query Account --output text)" \
  --budget file:///tmp/budget.json \
  --notifications-with-subscribers file:///tmp/budget-notifications.json
```

No output means it worked. A $20 limit with an alert at half of it, against an
environment that costs roughly $42 a month while it is running, means the mail
arrives within days of a stage being left up rather than at the end of the
month.

A budget alerts, it does not stop anything. Nothing in AWS turns the taps off
for us, which is the other half of why the deploy guide tears the stage down
between uses.

## The deploy identity

We do not deploy as root, and we do not deploy with an IAM user holding access
keys. An access key is a credential that works forever, sitting in a file on a
laptop, in a shell history, and in whatever backup that laptop makes. IAM
Identity Center hands out a credential that expires by itself in a few hours,
which turns a leaked credential from a standing problem into a short one. It
costs nothing.

In the console, in `ap-south-2`:

1. **Enable IAM Identity Center.** It asks to enable AWS Organizations at the
   same time, which is fine and free. Note the start URL it gives, which looks
   like `https://d-xxxxxxxxxx.awsapps.com/start`. Ours is
   `https://d-ca671b92fd.awsapps.com/start`.
2. **Create a user.** The username is what gets typed at every sign-in, so keep
   it short, lowercase, and personal rather than functional: `sushanth`, not
   `admin` or `deploy`. It is a person, and later it will sit beside other
   people. Set up MFA for it when prompted.
3. **Create a permission set** called `AdministratorAccess`, from the predefined
   list.
4. **Assign** the user to the account with that permission set.

`AdministratorAccess` is wider than a deploy needs. It is deliberate for now:
narrowing it correctly means knowing which API calls the deploy actually makes,
and guessing at that list produces a permission set that fails halfway through
creating a VPC. The deploy guide records what the first deploy touched so a
later, narrower permission set can be built from evidence rather than
imagination. It is worth doing before anyone else is added to this account.

## Wiring it to the CLI

```sh
aws configure sso
```

The answers:

| Prompt | Answer |
|---|---|
| SSO session name | `kanso` |
| SSO start URL | the start URL from step 1 above |
| SSO region | `ap-south-2` |
| SSO registration scopes | `sso:account:access`, the default |
| CLI default client region | `ap-south-2` |
| CLI default output format | `json` |
| CLI profile name | `kanso` |

A browser opens and asks to approve the sign-in. The result lands in
`~/.aws/config`, which holds no secret: it is a pointer to the start URL and a
role name. The actual credential lives in the `~/.aws/sso/cache` directory and
expires on its own.

The profile is named rather than default on purpose, so nothing reaches this
account by accident. Every AWS command in our guides passes `--profile kanso`.

## Every session after this

```sh
aws sso login --profile kanso
```

Then check it:

```sh
aws sts get-caller-identity --profile kanso
```

That prints an account id and an assumed-role ARN ending in the username. If it
prints `NoCredentials` or an expired-token error, the session has lapsed and
`aws sso login` again is the whole fix.

Setting `AWS_PROFILE=kanso` in the shell works too and saves the flag. Be aware
that a fish universal variable set this way does not reach a subshell started by
another tool, so a command that fails for want of credentials is worth retrying
with the explicit flag before assuming anything is broken.

## What this deliberately does not set up

**Separate accounts per environment.** One account holds every stage, separated
by SST stage name. Separate accounts per environment is the right answer at the
point where a mistake in a development stage can reach real player data, and
nothing here is real yet.

**A narrower permission set.** Named above, waiting on evidence from real
deploys.

**A CI deploy role.** Nothing deploys from GitHub Actions yet. When something
does, it gets its own role assumed through OIDC rather than an access key in a
repository secret, and it goes in this guide beside the human identity.
