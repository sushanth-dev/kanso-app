/**
 * The client options that point an AWS SDK client at LocalStack.
 *
 * LocalStack accepts any credentials, but the SDK's default provider chain
 * skips the AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY environment pair whenever
 * AWS_PROFILE is set, then resolves the profile, which on a developer machine
 * is usually an expired SSO session. Passing explicit static credentials is
 * the only way to guarantee a LocalStack client never consults the ambient
 * profile. The region is pinned to ap-south-2, our production region, rather
 * than read from a profile that might name a different one.
 */
export const localstackClientOptions = {
  region: 'ap-south-2',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
};
