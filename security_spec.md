# MajiTrack RBAC Security Specification

1. **Authentication & Verified Email Mandate**:
   - All reads and writes require `request.auth != null`, `request.auth.token.email_verified == true`, and a valid email string.
   - Default-deny catch-all (`match /{document=**} { allow read, write: if false; }`) is declared first.

2. **Three-Tier RBAC (`superadmin`, `admin`, `operator`)**:
   - **Super Admin (`superadmin`)**: Bootstrapped for runtime owner email `vyktorke@gmail.com` (only when `email_verified == true`), or assigned via `/staffAccess/{email}` (`role == 'superadmin'`) created by an existing Super Admin.
   - **Admin (`admin`)**: Explicitly authorized in `/staffAccess/{email}` (`role == 'admin'`) by a Super Admin. Can read/write the shared utility workspace (`/workspaces/{workspaceId}/...`), read staff access entries, and read user profiles.
   - **Operator (`operator`)**: Default role for any other verified Google account. Can only read/write their own `/users/{request.auth.uid}/...` workspace and their own `/users/{request.auth.uid}` profile; blocked from reading or writing `/workspaces/...` or `/staffAccess/...`.

3. **Anti-Privilege Escalation & Self-Assignment Protection**:
   - Regular users creating `/users/{userId}` can ONLY create `role == 'operator'` unless they are `isSuperAdmin()` or have a matching trusted `/staffAccess/{email}` document granting `admin` or `superadmin`.
   - Regular users and Admins updating their own `/users/{userId}` document CANNOT modify `role`, `uid`, `email`, or `createdAt`. Only `isSuperAdmin()` can update `role` on user profiles or manage `/staffAccess/{email}`.

4. **Strict Schema & Payload Validation**:
   - Every collection uses `isValid[Entity]()` checking exact allowed keys (`hasAll` + `hasOnly`), type safety, string `.size()` bounds, numeric min/max bounds, enum values, and `request.time` / timestamp checks.
   - Meter dial `photoUrl` payloads are bounded to `size() <= 200000` characters.
   - Customer dispatch logs (`notifications`) enforce `channel in ['SMS', 'EMAIL', 'WHATSAPP']`, `status in ['Delivered', 'Sent', 'Pending', 'Failed']`, and bounded `messageSummary` (`<= 500` chars).

    - Payment records (`payments`) and M-Pesa C2B Paybill receipts (`mpesaTransactions`) enforce strict key allowlists (`hasAll` + `hasOnly`), positive `amountKsh`/`transAmount`, `status in ['Completed', 'Pending', 'Failed']` or `['Completed', 'Unmatched', 'Failed']`, and bounded `BillRefNumber`/`MSISDN`/`TransID` strings.
