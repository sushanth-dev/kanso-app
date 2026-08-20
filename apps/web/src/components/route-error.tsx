import { useRouter } from '@tanstack/react-router';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';

/**
 * DEBT-015. The shared error-and-retry state for the account shell. A
 * non-401, non-consent `/me` failure throws in `accountRoute.beforeLoad` and
 * lands here for every account-scoped route, instead of the router-wide
 * default. The 401-to-sign-in and `consent_required` paths stay in
 * `beforeLoad` and are not this surface.
 */
export function RouteError() {
  const router = useRouter();
  return (
    <EmptyState
      title="This page could not be loaded"
      description="Try again, or go back to your account."
      headingLevel={1}
      actions={
        <Button
          label="Retry"
          variant="primary"
          onClick={() => {
            void router.invalidate();
          }}
        />
      }
    />
  );
}
