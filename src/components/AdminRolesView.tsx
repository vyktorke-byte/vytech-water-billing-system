import React, { useCallback, useEffect, useState } from 'react';
import { OperatorProfile, StaffAccessEntry, UserRole } from '../types/billing';
import {
  BOOTSTRAP_SUPERADMIN_EMAIL,
  grantStaffAccessEntry,
  listStaffAccessEntries,
  revokeStaffAccessEntry,
  updateOperatorProfileDisplayName,
} from '../lib/billingFirestore';
import { auth, updateOperatorAccountCredentials } from '../lib/firebase';
import { Button, Field, SelectField, Surface } from './ui';
import { Crown, Edit3, KeyRound, Plus, Shield, Trash2, UserCheck } from 'lucide-react';

interface AdminRolesViewProps {
  profile: OperatorProfile;
  onNotice: (message: string) => void;
  onProfileUpdated?: (displayName: string) => void;
}

export function AdminRolesView({
  profile,
  onNotice,
  onProfileUpdated,
}: AdminRolesViewProps) {
  const [entries, setEntries] = useState<StaffAccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // My Account Credentials state
  const [myDisplayName, setMyDisplayName] = useState(profile.displayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [credMessage, setCredMessage] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(
    null
  );

  // Staff grant / edit state
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [roleInput, setRoleInput] = useState<UserRole>('admin');
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = profile.role === 'superadmin';

  useEffect(() => {
    setMyDisplayName(profile.displayName);
  }, [profile.displayName]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listStaffAccessEntries(profile.email);
      setEntries(list);
    } catch {
      setError('Could not load staff role directory.');
    } finally {
      setLoading(false);
    }
  }, [profile.email]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleSaveMyCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const cleanName = myDisplayName.trim();
    if (!cleanName) {
      setCredMessage({ tone: 'danger', text: 'Display name cannot be empty.' });
      return;
    }

    if (newPassword || confirmPassword) {
      if (newPassword.length < 6) {
        setCredMessage({ tone: 'danger', text: 'New password must be at least 6 characters.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        setCredMessage({ tone: 'danger', text: 'New password and confirmation do not match.' });
        return;
      }
      if (!currentPassword) {
        setCredMessage({
          tone: 'danger',
          text: 'Enter your current password to verify before updating your password.',
        });
        return;
      }
    }

    setSavingCredentials(true);
    setCredMessage(null);
    try {
      await updateOperatorAccountCredentials({
        user,
        displayName: cleanName,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      await updateOperatorProfileDisplayName(user.uid, cleanName);
      onProfileUpdated?.(cleanName);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      const msg = newPassword
        ? 'Updated your display name and sign-in password.'
        : 'Updated your operator display name.';
      setCredMessage({ tone: 'accent', text: msg });
      onNotice(msg);
    } catch (err: unknown) {
      const text =
        err instanceof Error
          ? err.message
          : 'Could not update account credentials. Check your current password and try again.';
      setCredMessage({ tone: 'danger', text });
    } finally {
      setSavingCredentials(false);
    }
  };

  const handleGrantRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await grantStaffAccessEntry({
        email: cleanEmail,
        role: roleInput,
        displayName: nameInput.trim() || cleanEmail.split('@')[0],
        assignedByEmail: profile.email,
      });
      setEmailInput('');
      setNameInput('');
      setRoleInput('admin');
      setEditingEmail(null);
      await loadEntries();
      onNotice(`Saved ${roleInput.toUpperCase()} access for ${cleanEmail}`);
    } catch {
      setError('Failed to save role assignment. Verify Super Admin permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditStaff = (entry: StaffAccessEntry) => {
    setEmailInput(entry.email);
    setNameInput(entry.displayName);
    setRoleInput(entry.role);
    setEditingEmail(entry.email);
    setError(null);
  };

  const handleRevoke = async (email: string) => {
    if (email.toLowerCase() === BOOTSTRAP_SUPERADMIN_EMAIL) return;
    try {
      await revokeStaffAccessEntry(email);
      await loadEntries();
      onNotice(`Revoked elevated staff access for ${email}`);
    } catch {
      setError('Failed to remove access entry.');
    }
  };

  const renderRoleTag = (role: UserRole) => {
    if (role === 'superadmin') {
      return (
        <span className="inline-flex items-center gap-1 rounded-control bg-primary/15 px-2 py-0.5 text-caption font-semibold text-primary">
          <Crown className="size-3" />
          Super Admin
        </span>
      );
    }
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 rounded-control bg-accent/15 px-2 py-0.5 text-caption font-semibold text-accent">
          <Shield className="size-3" />
          Admin
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-control border border-border/45 px-2 py-0.5 text-caption font-medium text-muted">
        <UserCheck className="size-3" />
        Operator
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Signed-in Privilege Overview */}
      <Surface className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-section font-semibold text-foreground">
                {profile.displayName}
              </h2>
              {renderRoleTag(profile.role)}
            </div>
            <p className="text-caption text-muted">
              Signed in as <span className="font-mono text-foreground">{profile.email}</span> · Shared Gawanji Heights Utility Workspace
            </p>
          </div>
          <div className="text-caption text-muted">
            {isSuperAdmin
              ? 'Root privilege: can authorize Admins, Super Admins & Operators'
              : 'Admin privilege: full access to shared utility ledger & reports'}
          </div>
        </div>
      </Surface>

      {/* Edit My Account Credentials */}
      <Surface className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <div>
            <h3 className="text-section text-foreground">Edit My Account Credentials</h3>
            <p className="text-caption text-muted">
              Update your operator display name or change your sign-in password.
            </p>
          </div>
        </div>

        {credMessage ? (
          <p
            role="status"
            className={`text-caption font-medium ${
              credMessage.tone === 'accent' ? 'text-accent' : 'text-danger'
            }`}
          >
            {credMessage.text}
          </p>
        ) : null}

        <form onSubmit={handleSaveMyCredentials} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Account Email (Read-only)"
              type="email"
              value={profile.email}
              disabled
            />
            <Field
              label="Operator Display Name"
              type="text"
              value={myDisplayName}
              onChange={(e) => {
                setMyDisplayName(e.target.value);
                setCredMessage(null);
              }}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Current Password (only to change password)"
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setCredMessage(null);
              }}
            />
            <Field
              label="New Password (optional)"
              type="password"
              placeholder="Min 6 characters"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setCredMessage(null);
              }}
            />
            <Field
              label="Confirm New Password"
              type="password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setCredMessage(null);
              }}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" tone="primary" disabled={savingCredentials}>
              {savingCredentials ? 'Saving credentials…' : 'Save Account Credentials'}
            </Button>
          </div>
        </form>
      </Surface>

      {/* Role Permissions Matrix */}
      <Surface className="overflow-hidden">
        <div className="border-b border-border/35 px-5 py-3.5">
          <h3 className="text-section text-foreground">Access Tiers &amp; Capabilities</h3>
          <p className="text-caption text-muted">
            Server-enforced Firestore role boundaries for MajiTrack staff
          </p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-border/35 md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="p-4 space-y-1.5">
            {renderRoleTag('superadmin')}
            <p className="text-caption text-muted pt-1">
              Full access to shared billing ledger, tariff schedules, municipal PDFs, plus adding/revoking Admin and Super Admin accounts.
            </p>
          </div>
          <div className="p-4 space-y-1.5">
            {renderRoleTag('admin')}
            <p className="text-caption text-muted pt-1">
              Full access to shared apartment connections, meter dial photos, invoices, M-Pesa Paybill receipts, and monthly reports.
            </p>
          </div>
          <div className="p-4 space-y-1.5">
            {renderRoleTag('operator')}
            <p className="text-caption text-muted pt-1">
              Isolated personal workspace for field meter reading capture, dial photography, and billing operations.
            </p>
          </div>
        </div>
      </Surface>

      {/* Super Admin: Authorize or Edit Staff Form */}
      {isSuperAdmin ? (
        <Surface className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-section text-foreground">
                {editingEmail ? `Edit Staff Access (${editingEmail})` : 'Authorize Admin or Super Admin'}
              </h3>
              <p className="text-caption text-muted">
                Add or update a staff email address below so they sign directly into the shared utility ledger as Admin or Super Admin.
              </p>
            </div>
            {editingEmail ? (
              <Button
                tone="quiet"
                size="sm"
                onClick={() => {
                  setEditingEmail(null);
                  setEmailInput('');
                  setNameInput('');
                  setRoleInput('admin');
                }}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-caption font-medium text-danger">
              {error}
            </p>
          ) : null}

          <form onSubmit={handleGrantRole} className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-5">
              <Field
                label="Staff Email"
                type="email"
                placeholder="admin@example.com"
                value={emailInput}
                disabled={Boolean(editingEmail)}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  setError(null);
                }}
                required
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="Staff Name"
                type="text"
                placeholder="e.g. Jane Mwangi"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <SelectField
                label="Role"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as UserRole)}
              >
                <option value="admin">Admin</option>
                <option value="superadmin">Super Admin</option>
                <option value="operator">Operator</option>
              </SelectField>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" tone="primary" disabled={saving} className="w-full">
                <Plus className="size-4" />
                {saving ? 'Saving…' : editingEmail ? 'Update role' : 'Grant role'}
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {/* Staff Directory */}
      <Surface className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/35 px-5 py-3.5">
          <div>
            <h3 className="text-section text-foreground">Authorized Staff Directory</h3>
            <p className="text-caption text-muted">
              {entries.length} {entries.length === 1 ? 'account' : 'accounts'} listed
            </p>
          </div>
          <Button tone="quiet" size="sm" onClick={() => void loadEntries()}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-caption text-muted">
            Loading role assignments…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-8 text-center text-caption text-muted">
            No extra Admin accounts assigned yet. Root Super Admin ({BOOTSTRAP_SUPERADMIN_EMAIL}) is always active.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/30 bg-surface-muted/20 text-caption font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Staff Member</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Assigned By</th>
                  {isSuperAdmin ? <th className="px-4 py-2.5 text-right">Action</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25 text-body">
                {entries.map((entry) => {
                  const isRoot = entry.email.toLowerCase() === BOOTSTRAP_SUPERADMIN_EMAIL;
                  return (
                    <tr key={entry.email} className="hover:bg-background/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{entry.displayName}</div>
                        <div className="font-mono text-caption text-muted">{entry.email}</div>
                      </td>
                      <td className="px-4 py-3">{renderRoleTag(entry.role)}</td>
                      <td className="px-4 py-3 text-caption font-mono text-muted">
                        {entry.assignedByEmail || BOOTSTRAP_SUPERADMIN_EMAIL}
                      </td>
                      {isSuperAdmin ? (
                        <td className="px-4 py-3 text-right">
                          {isRoot ? (
                            <span className="text-caption text-muted">Root Super Admin</span>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                tone="quiet"
                                size="sm"
                                onClick={() => handleStartEditStaff(entry)}
                              >
                                <Edit3 className="size-3.5" />
                                Edit
                              </Button>
                              <Button
                                tone="danger"
                                size="sm"
                                onClick={() => void handleRevoke(entry.email)}
                              >
                                <Trash2 className="size-3.5" />
                                Revoke
                              </Button>
                            </div>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}
