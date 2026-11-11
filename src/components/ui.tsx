import React, { Component, type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Surface primitive: inset is reserved strictly for recessed interactive stages, never stat/callout sub-boxes.
 */
export const Surface = ({
  inset = false,
  className = '',
  ...props
}: ComponentProps<'div'> & { inset?: boolean }) => (
  <div
    className={`min-w-0 rounded-card text-foreground ${
      inset ? 'border border-border/45 bg-background' : 'border border-border/35 bg-surface shadow-surface'
    } ${className}`}
    {...props}
  />
);

const buttonTones = {
  primary: 'bg-primary text-primary-foreground hover:brightness-110',
  accent: 'bg-accent text-accent-foreground hover:brightness-105',
  quiet: 'border border-border/50 bg-surface text-foreground hover:bg-background',
  ghost: 'bg-transparent text-foreground hover:bg-background',
  danger: 'border border-danger/45 bg-surface text-danger hover:bg-danger/5',
};

const buttonSizes = {
  md: 'min-h-11 px-4 text-label',
  sm: 'min-h-9 px-3 text-caption font-medium',
};

export const Button = ({
  tone = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: ComponentProps<'button'> & {
  tone?: keyof typeof buttonTones;
  size?: keyof typeof buttonSizes;
}) => (
  <button
    type={type}
    className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${buttonTones[tone]} ${buttonSizes[size]} ${className}`}
    {...props}
  />
);

export const Field = ({
  label,
  hint,
  error,
  id,
  className = '',
  ...inputProps
}: ComponentProps<'input'> & {
  label: string;
  hint?: string;
  error?: string;
}) => {
  const inputId = id || `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={inputId} className="mb-1.5 block text-label text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        className={`min-h-11 w-full rounded-control border bg-surface px-3 text-body text-foreground placeholder:text-muted/75 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60 ${
          error ? 'border-danger' : 'border-border/60'
        }`}
        {...inputProps}
      />
      {error ? (
        <p role="alert" className="mt-1 text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
};

export const SelectField = ({
  label,
  hint,
  id,
  children,
  className = '',
  ...selectProps
}: ComponentProps<'select'> & {
  label: string;
  hint?: string;
}) => {
  const selectId = id || `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={selectId} className="mb-1.5 block text-label text-foreground">
        {label}
      </label>
      <select
        id={selectId}
        className="min-h-11 w-full rounded-control border border-border/60 bg-surface px-3 text-body text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60"
        {...selectProps}
      >
        {children}
      </select>
      {hint ? <p className="mt-1 text-caption text-muted">{hint}</p> : null}
    </div>
  );
};

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className={`m-auto w-[calc(100%-2rem)] ${maxWidthClass} rounded-card border border-border/45 bg-surface p-0 text-foreground shadow-lg backdrop:bg-foreground/35`}
    >
      <div className="divide-y divide-border/35">
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-section text-foreground">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-caption text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </dialog>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : 'Unexpected workspace error.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <Surface className="max-w-md p-6">
            <div role="alert" className="space-y-3">
              <h1 className="text-title text-foreground">Workspace interrupted</h1>
              <p className="text-body text-muted">{this.state.message}</p>
              <Button onClick={() => window.location.reload()}>Reload application</Button>
            </div>
          </Surface>
        </div>
      );
    }
    return this.props.children;
  }
}
