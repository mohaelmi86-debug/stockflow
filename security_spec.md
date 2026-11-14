# Security Specification — StockFlow ERP Multi-Tenant Firestore Rules

## 1. Data Invariants
1. **Strict Tenant Isolation**: No user can read, list, create, update, or delete any document inside `/organizations/{orgId}/*` unless their verified UID exists in `/organizations/{orgId}/members/{uid}` with `status == 'active'` (and for `list`, `request.auth.uid in resource.data.memberUids` with bounded array `.size() <= 50`).
2. **PII Isolation**: `/users/{userId}` containing email and profile PII is strictly readable and writable only by `request.auth.uid == userId`.
3. **Immutable Stock Ledger**: `stockMovements` and `auditLogs` are append-only; updates and deletes are strictly forbidden to preserve audit trail and stock traceability.
4. **No Self-Privilege Escalation**: A user cannot assign themselves a role higher than allowed when joining or modify their own `role` without being an `owner`/`admin` of the organization.
5. **Temporal & Identity Integrity**: `createdAt` and `updatedAt` must equal `request.time`; `performedByUid`/`actorUid`/`ownerId` must match `request.auth.uid`.
6. **Path ID & Payload Bounds**: Every document ID matches `^[a-zA-Z0-9_\-]+$` (max 128 chars); every string and array has explicit `.size()` constraints.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/organizations/org_1/products/prod_1`.
2. Cross-tenant read on `/organizations/org_other/products/prod_1` by authenticated user of `org_1`.
3. Cross-tenant `list` query on `/organizations/org_other/stockBalances` without `memberUids` containment.
4. Shadow field injection (`isAdmin: true` or `ghostField: 1`) on `products` creation.
5. Identity spoofing (`performedByUid: "other_uid"`) on `stockMovements` creation.
6. Client timestamp spoofing (`createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`) on `organizations` creation.
7. Mutation (`update` or `delete`) on immutable `stockMovements/{movementId}` ledger document.
8. Mutation (`update` or `delete`) on immutable `auditLogs/{logId}` entry.
9. Oversized ID poisoning (`1.5KB` string as `productId` path variable).
10. Unbounded array injection (`memberUids` > 50 elements) on `products`.
11. Viewer role attempting to create or update a `Product` or `StockBalance`.
12. Non-owner attempting to read `/users/other_uid` private PII document.
