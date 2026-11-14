import React, { useState } from 'react';
import {
  Crown,
  Droplets,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  registerWithEmailPassword,
  sendOperatorPasswordReset,
  signInWithEmailPassword,
} from '../lib/firebase';
import { UserRole } from '../types/billing';
import { Button, Field, Surface } from './ui';

const BRAND_LOGO_PATH = '/assets/aistudio/vytech-icon_a1bffa57.svg';
export const LOGIN_ROLE_INTENT_KEY = 'majitrack_login_role_intent';

type AuthMode = 'signin' | 'register' | 'reset';

interface RolePortalOption {
  role: UserRole;
  title: string;
  subtitle: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROLE_PORTALS: RolePortalOption[] = [
  {
    role: 'superadmin',
    title: 'Super Admin',
    subtitle: 'Full system control, tariffs, municipal PDFs & team role assignment',
    badge: 'Root Authority',
    icon: Crown,
  },
  {
    role: 'admin',
    title: 'Admin',
    subtitle: 'Shared Gawanji Heights ledger, payments, invoices & meter audits',
    badge: 'Utility Admin',
    icon: Shield,
  },
  {
    role: 'operator',
    title: 'Field Operator',
    subtitle: 'Meter register capture, live dial photos & customer receipts',
    badge: 'Field Clerk',
    icon: UserCheck,
  },
];

function mapFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email address or password. Check your credentials or use Forgot password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Switch to Sign in with your password.';
    case 'auth/weak-password':
      return 'Password is too weak. Choose a password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many failed sign-in attempts. Wait a few moments or reset your password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact the Super Admin.';
    case 'auth/operation-not-allowed':
      return 'Email/Password authentication is not yet enabled in Firebase Console (Authentication → Sign-in method → Email/Password).';
    default:
      return err instanceof Error
        ? err.message
        : 'Authentication failed. Check your connection and try again.';
  }
}

export function LoginScreen() {
  const [selectedPortal, setSelectedPortal] = useState<UserRole>('superadmin');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setAuthMode(nextMode);
    setAuthError(null);
    setAuthInfo(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError('Enter your email address.');
      return;
    }

    if (authMode === 'reset') {
      setSubmitting(true);
      try {
        await sendOperatorPasswordReset(trimmedEmail);
        setAuthInfo(
          `Password reset link sent to ${trimmedEmail}. Check your inbox and spam folder, then sign in with your new password.`
        );
      } catch (err: unknown) {
        setAuthError(mapFirebaseAuthError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    if (authMode === 'register') {
      if (!fullName.trim()) {
        setAuthError('Enter your full name to register.');
        return;
      }
      if (password !== confirmPassword) {
        setAuthError('Passwords do not match.');
        return;
      }
    }

    try {
      window.sessionStorage.setItem(LOGIN_ROLE_INTENT_KEY, selectedPortal);
    } catch {
      // Ignore sessionStorage restrictions
    }

    setSubmitting(true);
    try {
      if (authMode === 'register') {
        await registerWithEmailPassword(trimmedEmail, password, fullName);
      } else {
        await signInWithEmailPassword(trimmedEmail, password);
      }
    } catch (err: unknown) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full flex-col justify-between bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between border-b border-border/35 pb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {!logoFailed ? (
            <img
              src={BRAND_LOGO_PATH}
              alt="MajiTrack emblem"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="size-9 shrink-0 rounded-control object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-primary font-semibold text-primary-foreground"
            >
              M
            </span>
          )}
          <div className="flex flex-col min-w-0 leading-tight">
            <span className="text-section font-bold tracking-tight text-foreground">
              MajiTrack
            </span>
            <span className="text-[11px] font-mono text-muted">
              majitracksystembilling.net · Gawanji Heights Apartments
            </span>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-control border border-border/45 bg-surface px-2.5 py-1 text-caption font-medium text-muted">
          <ShieldCheck className="size-3.5 text-primary" />
          Admin &amp; Operator Portal
        </span>
      </header>

      <main className="mx-auto my-auto grid w-full max-w-5xl grid-cols-1 items-center gap-8 py-8 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-6">
          <div className="inline-flex items-center gap-2 rounded-control border border-primary/25 bg-primary/8 px-3 py-1 text-caption font-semibold text-primary">
            <Droplets className="size-3.5" />
            <span>Utility Metering &amp; Municipal Collection</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Sign in as Super Admin, Admin, or Field Operator
          </h1>

          <p className="max-w-xl text-body text-muted">
            Select your access portal and enter your email and password. Super Admins and authorized Admins share the live Gawanji Heights utility ledger and manage team permissions inside the system.
          </p>

          <div className="space-y-2.5 pt-1">
            {ROLE_PORTALS.map((portal) => {
              const Icon = portal.icon;
              const selected = selectedPortal === portal.role;
              return (
                <button
                  key={portal.role}
                  type="button"
                  onClick={() => setSelectedPortal(portal.role)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-card border p-3.5 text-left transition-colors ${
                    selected
                      ? 'border-primary bg-primary/8'
                      : 'border-border/45 bg-surface hover:bg-background'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-control ${
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted'
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-semibold text-foreground">
                        {portal.title}
                      </span>
                      <span className="text-[11px] font-mono text-muted">
                        {portal.badge}
                      </span>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">{portal.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-6">
          <Surface className="p-6 sm:p-7 space-y-5">
            {/* Mode Tabs: Sign In / Create Account */}
            {authMode !== 'reset' ? (
              <div
                role="tablist"
                aria-label="Account authentication mode"
                className="grid grid-cols-2 rounded-control border border-border/50 bg-background p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'signin'}
                  onClick={() => switchMode('signin')}
                  className={`min-h-9 cursor-pointer rounded-control text-label font-medium transition-colors ${
                    authMode === 'signin'
                      ? 'bg-surface text-foreground shadow-xs'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'register'}
                  onClick={() => switchMode('register')}
                  className={`min-h-9 cursor-pointer rounded-control text-label font-medium transition-colors ${
                    authMode === 'register'
                      ? 'bg-surface text-foreground shadow-xs'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  Create account
                </button>
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-caption font-mono uppercase tracking-wider text-primary">
                {selectedPortal === 'superadmin'
                  ? 'Super Admin Access'
                  : selectedPortal === 'admin'
                  ? 'Admin Access'
                  : 'Operator Access'}
              </div>
              <h2 className="text-title font-bold text-foreground">
                {authMode === 'reset'
                  ? 'Reset your password'
                  : authMode === 'register'
                  ? 'Create staff account'
                  : selectedPortal === 'superadmin'
                  ? 'Super Admin Sign In'
                  : selectedPortal === 'admin'
                  ? 'Admin Sign In'
                  : 'Operator Sign In'}
              </h2>
              <p className="text-caption text-muted">
                {authMode === 'reset'
                  ? 'Enter your registered email address to receive a password reset link.'
                  : authMode === 'register'
                  ? 'Register with your staff email and password. A verification email will be sent before accessing the ledger.'
                  : selectedPortal === 'superadmin'
                  ? 'Enter the root Super Admin email (vyktorke@gmail.com) and password, or a promoted Super Admin account.'
                  : selectedPortal === 'admin'
                  ? 'Sign in with an Admin email and password authorized by the Super Admin.'
                  : 'Sign in with your operator email and password for meter capture and billing.'}
              </p>
            </div>

            {authError ? (
              <div
                role="alert"
                className="rounded-control border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-caption text-danger"
              >
                {authError}
              </div>
            ) : null}

            {authInfo ? (
              <div
                role="status"
                className="rounded-control border border-accent/35 bg-accent/10 px-3.5 py-2.5 text-caption text-accent"
              >
                {authInfo}
              </div>
            ) : null}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {authMode === 'register' ? (
                <Field
                  label="Full name"
                  type="text"
                  placeholder="e.g. Victor Kimani"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              ) : null}

              <Field
                label="Email address"
                type="email"
                placeholder="name@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAuthError(null);
                }}
                required
              />

              {authMode !== 'reset' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="login-password"
                      className="block text-label text-foreground"
                    >
                      Password
                    </label>
                    {authMode === 'signin' ? (
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="cursor-pointer text-caption font-medium text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    ) : null}
                  </div>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        authMode === 'register' ? 'new-password' : 'current-password'
                      }
                      placeholder={
                        authMode === 'register'
                          ? 'At least 6 characters'
                          : 'Enter your password'
                      }
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setAuthError(null);
                      }}
                      required
                      minLength={6}
                      className="min-h-10 w-full rounded-control border border-border/55 bg-surface px-3 pr-10 text-body text-foreground placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded-control p-1 text-muted hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              ) : null}

              {authMode === 'register' ? (
                <Field
                  label="Confirm password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setAuthError(null);
                  }}
                  required
                  minLength={6}
                />
              ) : null}

              <Button
                type="submit"
                tone="primary"
                disabled={submitting}
                className="w-full min-h-11 justify-center gap-2 text-label font-semibold"
              >
                {authMode === 'reset' ? (
                  <Mail className="size-4" />
                ) : authMode === 'register' ? (
                  <KeyRound className="size-4" />
                ) : (
                  <Lock className="size-4" />
                )}
                <span>
                  {submitting
                    ? authMode === 'reset'
                      ? 'Sending reset email…'
                      : authMode === 'register'
                      ? 'Creating account…'
                      : 'Signing in…'
                    : authMode === 'reset'
                    ? 'Send password reset email'
                    : authMode === 'register'
                    ? 'Create account & verify email'
                    : selectedPortal === 'superadmin'
                    ? 'Sign in as Super Admin'
                    : selectedPortal === 'admin'
                    ? 'Sign in as Admin'
                    : 'Sign in as Operator'}
                </span>
              </Button>

              {authMode === 'reset' ? (
                <Button
                  type="button"
                  tone="quiet"
                  onClick={() => switchMode('signin')}
                  className="w-full justify-center"
                >
                  Back to sign in
                </Button>
              ) : null}
            </form>

            <div className="border-t border-border/35 pt-3.5 text-[11px] text-muted">
              Roles are verified server-side against Firestore security rules. Unlisted accounts sign in with Operator access until granted Admin or Super Admin privileges by the Super Admin.
            </div>
          </Surface>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 border-t border-border/35 pt-4 text-caption text-muted">
        <span>MajiTrack Water Utility System · Cycle Nov 2026</span>
        <span>majitracksystembilling.net</span>
      </footer>
    </div>
  );
}
