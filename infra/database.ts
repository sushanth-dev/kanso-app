/**
 * The VPC and the database.
 *
 * The database is in the private subnets, which is the whole of the network
 * half of this story's security assessment: there is no public endpoint, so the
 * internet cannot open a connection to it whatever the credential is. The API
 * reaches it inside the VPC.
 *
 * No NAT gateway. SST creates none by default, and nothing here needs one: the
 * database talks to nobody, and the API sits in the public subnets. A managed
 * NAT would be $65 a month for an outbound path we do not use.
 */
export const vpc = new sst.aws.Vpc('Vpc');

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
