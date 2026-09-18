/**
 * The announcement bar: ST-112 retired the hand-curated what's-new page for
 * "dashboard-configured announcements". The PostHog feature flag
 * `announcements` is that dashboard: released with a payload, the payload is
 * the announcement; off, absent, or empty, the bar renders nothing. The
 * payload is a plain sentence, or JSON `{"message": "...", "href": "/..."}`
 * for one call to action. Dismissal is per browser and keyed by the message,
 * so an edited message shows again without touching the flag.
 */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useEffect, useState } from 'react';
import posthog from 'posthog-js';

/** The one flag the shell consumes; its payload is the announcement. */
const FLAG_KEY = 'announcements';
const DISMISS_KEY = 'announcement-dismissed';

export interface AnnouncementPayload {
  message: string;
  href?: string;
}

export function parseAnnouncement(raw: unknown): AnnouncementPayload | null {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return parseAnnouncement(JSON.parse(raw));
    } catch {
      return { message: raw }; // not JSON: the payload is the message itself
    }
  }
  // The SDK contract is JsonType: posthog-js parses valid-JSON payloads
  // before returning them, so the object form is the live path.
  if (typeof raw !== 'object' || raw === null) return null;
  const { message, href } = raw as Record<string, unknown>;
  if (typeof message !== 'string' || message.length === 0) return null;
  return typeof href === 'string' && href.length > 0 ? { message, href } : { message };
}

/** A stable key per message: the same message stays dismissed, an edited one shows. */
export function dismissedKeyFor(message: string): string {
  let hash = 0;
  for (const ch of message) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `${DISMISS_KEY}-${hash}`;
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() =>
    window.localStorage.getItem(DISMISS_KEY),
  );

  // Flags ride the SDK's periodic re-sync, so an announcement edited in the
  // dashboard reaches open tabs without a reload.
  useEffect(
    () =>
      posthog.onFeatureFlags(() => {
        setAnnouncement(parseAnnouncement(posthog.getFeatureFlagPayload(FLAG_KEY)));
      }),
    [],
  );

  if (announcement === null || dismissed === dismissedKeyFor(announcement.message)) {
    return null;
  }

  const dismiss = () => {
    const key = dismissedKeyFor(announcement.message);
    window.localStorage.setItem(DISMISS_KEY, key);
    setDismissed(key);
  };

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="border-b border-border-subtle bg-raised"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2">
        <Text className="flex-1">{announcement.message}</Text>
        {announcement.href ? (
          <Link hasUnderline href={announcement.href}>
            Open
          </Link>
        ) : null}
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11"
          label="Dismiss announcement"
          icon={<Icon icon="close" size="sm" />}
          onClick={dismiss}
        />
      </div>
    </div>
  );
}
