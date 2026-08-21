import { useState, type SVGProps } from 'react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput, type TextInputProps } from './text-input.tsx';

/** Heroicons outline "eye" glyph, matching the stroke style of the design
 * system's vendored `eyeSlash` icon (no open-eye icon exists in the registry). */
function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.639 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.639 0-8.573-3.007-9.963-7.178z" />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

export type PasswordInputProps = Omit<TextInputProps, 'type'>;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      <TextInput
        {...props}
        type={revealed ? 'text' : 'password'}
        className={['pr-11', className].filter(Boolean).join(' ')}
      />
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1/2 -translate-y-1/2"
        label={revealed ? 'Hide password' : 'Show password'}
        icon={<Icon icon={revealed ? 'eyeSlash' : EyeIcon} size="sm" />}
        onClick={() => setRevealed((value) => !value)}
      />
    </div>
  );
}
