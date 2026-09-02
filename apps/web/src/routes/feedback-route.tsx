/**
 * ST-111. The feedback page: one bounded free-text message from a signed-in
 * player, stored against their account by POST /feedback. Nothing is emailed;
 * we read the table in SQL.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { ApiRequestError, accountApi } from '../api/account-api.ts';

const messageClassName =
  'min-h-28 w-full resize-y rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export function FeedbackRoute() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed === '') {
      setError('Write your feedback first.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    void accountApi
      .submitFeedback({ message: trimmed })
      .then(() => {
        setSent(true);
      })
      .catch((submitError: unknown) => {
        if (submitError instanceof ApiRequestError) {
          setError(submitError.message);
        } else {
          setError('The feedback could not be sent. Try again in a moment.');
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="space-y-4">
        <Heading level={1}>Feedback</Heading>
        <Text as="p" display="block" type="supporting">
          Tell us what works, what breaks, and what you wish Kanso Chess did. Every message lands
          with the team.
        </Text>
      </header>
      <Card className="mt-6 p-5">
        {sent ? (
          <Text as="p" display="block" className="text-sm text-primary" role="status">
            Thank you, the message is with us. We read every one.
          </Text>
        ) : (
          <form onSubmit={handleSubmit} aria-label="Send feedback">
            <FormLayout>
              <Field
                label="Your feedback"
                inputID="feedback-message"
                status={error === undefined ? undefined : { type: 'error', message: error }}
              >
                <textarea
                  id="feedback-message"
                  name="feedback-message"
                  rows={5}
                  maxLength={2000}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    setError(undefined);
                  }}
                  placeholder="What is on your mind?"
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={error === undefined ? undefined : 'feedback-message-status'}
                  className={messageClassName}
                />
              </Field>
              <Button
                type="submit"
                label="Send feedback"
                variant="primary"
                isDisabled={submitting || message.trim() === ''}
                isLoading={submitting}
                className="min-h-11 press"
              />
            </FormLayout>
          </form>
        )}
      </Card>
    </section>
  );
}
