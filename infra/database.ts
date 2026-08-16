/**
 * The VPC and the database.
 *
 * The database is in the private subnets, which is the whole of the network
 * half of this story's security assessment: there is no public endpoint, so the
 * internet cannot open a connection to it whatever the credential is. The API
 * reaches it inside the VPC.
 *
 * A NAT instance, not a NAT gateway. The API runs as a Lambda (ADR-0033), which
 * cannot take a public IP the way the Fargate task did, so it reaches the
 * internet - Chess.com, Lichess, SES, SQS - through a NAT from the private
 * subnets. Two `t4g.nano` instances cost about $6 a month; the managed gateway
 * would be about $64, which is more than the database. A single instance per
 * zone is a single point of failure an unpublished stage does not notice; the
 * managed gateway is the launch-time upgrade.
 */
export const vpc = new sst.aws.Vpc('Vpc', {
  nat: 'ec2',
});

export const database = new sst.aws.Postgres('Database', {
  vpc,
  // ADR-0022. The component defaults to 17, so this line is the difference
  // between running what the record claims and running something else.
  version: '18',
  instance: 't4g.micro',
  storage: '20 GB',
  // ST-008 measures analysis cost, not availability, and a standby doubles the
  // bill to serve traffic it never serves. ADR-0014 sizes this for the API's
  // query load rather than the analysis burst.
  multiAz: false,
  transform: {
    instance: (args) => {
      // Set rather than left to a default, so a reviewer can see it. Both are
      // AWS defaults today and both are the kind of default that changes.
      args.storageEncrypted = true;
      args.publiclyAccessible = false;
      args.backupRetentionPeriod = 7;
      args.deletionProtection = $app.stage === 'production';
    },
  },
});
