import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Link } from '@astryxdesign/core/Link';
import { authClient } from '../auth-client.ts';
import { Clouds } from '../components/canvas-ui/Clouds.tsx';
import { PasswordInput } from '../components/password-input.tsx';
import { StatusMessage } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { ME_QUERY_KEY } from '../query-client.ts';

export type AuthMode = 'sign-in' | 'sign-up';
export type NavigateTo = (options: {
  to: string;
  search?: Record<string, unknown>;
}) => void | Promise<void>;

export interface AuthScreenProps {
  mode: AuthMode;
  navigate: NavigateTo;
  queryClient: QueryClient;
}

const REJECTION_COPY = 'Email or password was not accepted.';
const RATE_LIMIT_COPY = 'Too many attempts. Try again later.';
const MISMATCH_COPY = 'Passwords do not match.';
const GUARDIAN_MISMATCH_COPY = 'The guardian email must be different from the sign-up email.';

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

/** The client-side mirror of the server's age gate: under 13 (ST-034). */
function isMinorDob(dateOfBirth: string): boolean {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  if (!year || !month || !day) return false;
  const thirteenthBirthday = new Date(year + 13, month - 1, day);
  return new Date() < thirteenthBirthday;
}

const AMBIENT_CLOUD_COLOR: [number, number, number] = [1, 1, 1];

export function AuthAmbient() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <Clouds
        className="h-full w-full"
        color={AMBIENT_CLOUD_COLOR}
        opacity={0.7}
        cover={0.35}
        shading={0.6}
        shadow={0.12}
        density={1.2}
        speed={0.35}
      >
        <div className="auth-ambient-glow h-full w-full" />
      </Clouds>
    </div>
  );
}

export function AuthScreen({ mode, navigate, queryClient }: AuthScreenProps) {
  const isSignUp = mode === 'sign-up';
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const showGuardianEmail = isSignUp && isMinorDob(dateOfBirth);

  const heading = isSignUp ? 'Create your account' : 'Sign in';
  const submitLabel = isSignUp ? 'Sign up' : 'Sign in';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const data = new FormData(event.currentTarget);
    const email = readText(data, 'email').trim();
    const password = readText(data, 'password');
    const name = readText(data, 'name').trim();
    const dateOfBirthValue = readText(data, 'dateOfBirth');
    const guardianEmail = readText(data, 'guardianEmail').trim();

    if (isSignUp) {
      const confirmation = readText(data, 'passwordConfirmation');

      if (confirmation !== password) {
        setErrorMessage(MISMATCH_COPY);
        return;
      }

      if (showGuardianEmail && guardianEmail.toLowerCase() === email.toLowerCase()) {
        setErrorMessage(GUARDIAN_MISMATCH_COPY);
        return;
      }
    }

    setSubmitting(true);
    try {
      const { error } = isSignUp
        ? await authClient.signUp.email({
            name,
            email,
            password,
            dateOfBirth: dateOfBirthValue || undefined,
            guardianEmail: guardianEmail || undefined,
          })
        : await authClient.signIn.email({ email, password });
      if (error === null) {
        queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
        await navigate({ to: '/settings' });
        return;
      }
      setErrorMessage(error.status === 429 ? RATE_LIMIT_COPY : REJECTION_COPY);
    } catch {
      setErrorMessage(REJECTION_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AuthAmbient />
      <Card className="mx-auto w-full max-w-sm">
        <Heading level={1}>{heading}</Heading>
        {errorMessage !== null ? (
          <div className="mt-4">
            <StatusMessage tone="error">{errorMessage}</StatusMessage>
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <FormLayout>
            {isSignUp ? (
              <Field label="Name" inputID="name">
                <TextInput
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </Field>
            ) : null}
            {isSignUp ? (
              <Field label="Date of birth" inputID="dateOfBirth">
                <TextInput
                  id="dateOfBirth"
                  name="dateOfBirth"
                  type="date"
                  autoComplete="bday"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                />
              </Field>
            ) : null}
            {showGuardianEmail ? (
              <>
                <Text as="p" display="block" type="supporting" id="guardianEmail-help">
                  A guardian's email is required for players under 13, so a parent or guardian can
                  confirm consent.
                </Text>
                <Field label="Guardian email" inputID="guardianEmail">
                  <TextInput
                    id="guardianEmail"
                    name="guardianEmail"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    aria-describedby="guardianEmail-help"
                  />
                </Field>
              </>
            ) : null}
            <Field label="Email" inputID="email">
              <TextInput
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
            <Field label="Password" inputID="password">
              <PasswordInput
                id="password"
                name="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
                minLength={8}
              />
            </Field>
            {!isSignUp ? (
              <Text as="p" display="block" className="text-right">
                <Link href="/forgot-password">Forgot password?</Link>
              </Text>
            ) : null}
            {isSignUp ? (
              <Field label="Confirm password" inputID="passwordConfirmation">
                <PasswordInput
                  id="passwordConfirmation"
                  name="passwordConfirmation"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              label={submitLabel}
              variant="primary"
              isDisabled={submitting}
              isLoading={submitting}
              className="min-h-11 w-full press"
            />
          </FormLayout>
        </form>
        <Text as="p" display="block" type="supporting" className="mt-4 text-center">
          {isSignUp ? 'Already have an account? ' : 'Need an account? '}
          <Link href={isSignUp ? '/sign-in' : '/sign-up'}>{isSignUp ? 'Sign in' : 'Sign up'}</Link>
        </Text>
      </Card>
    </>
  );
}

export function SignInRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return <AuthScreen mode="sign-in" navigate={navigate} queryClient={queryClient} />;
}

export function SignUpRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return <AuthScreen mode="sign-up" navigate={navigate} queryClient={queryClient} />;
}
