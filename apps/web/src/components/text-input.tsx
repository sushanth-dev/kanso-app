import type { ComponentPropsWithoutRef } from 'react';

const textInputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';

export type TextInputProps = ComponentPropsWithoutRef<'input'>;

export function TextInput({ className, ...props }: TextInputProps) {
  return <input {...props} className={className ?? textInputClassName} />;
}
