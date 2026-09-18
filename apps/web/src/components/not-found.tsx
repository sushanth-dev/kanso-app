import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Link } from '@astryxdesign/core/Link';
import { useNavigate } from '@tanstack/react-router';

/**
 * The router's not-found surface (ST-165). Before this, an unknown path answered
 * 200, loaded the application, and rendered the bare string "Not Found".
 *
 * It renders inside the shell, because an unknown path matches none of the
 * public bypass entries in `RootComponent`, so it gets the wordmark header and
 * the navigation without carrying any chrome of its own.
 */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="That page does not exist"
      description="The address may be mistyped, or the page may have moved. Nothing is broken, and this is the one page we do not have."
      headingLevel={1}
      actions={
        <>
          <Button
            label="Go to the home page"
            variant="primary"
            onClick={() => {
              void navigate({ to: '/' });
            }}
          />
          <Link href="/contact">Contact us</Link>
        </>
      }
    />
  );
}
