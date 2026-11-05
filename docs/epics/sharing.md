# Epic 12: Sharing

## Status

📋 Planned for phase 2, after the first release. These are outlines: the RFC replaces them with real tasks.

## Overview

Sharing a list with other accounts, and assigning tasks. Phase 1 does not preclude it (§21), and does not build for it.

## Related

[`DESIGN.md`](../../DESIGN.md) §21 · Fjord's `clients/web/DESIGN.md` §12

## Tasks

#### 📋 12.1 — RFC: sharing

**Goal:** a reviewed design, before anything is built.

**Design:** §21. **Depends on:** 11.5.

**Technical:** `docs/rfcs/0001-sharing.md`. To settle: how an account is found with no directory (a server running alone) and with one (`directory.searchUsers`); recurring tasks on a shared list; how `owner_id` on a row gives way to membership, and its migration; how sync's cursor covers shared lists; per-account order, sort and state; what a backup and an export hold of a shared list; list keys for members, and a member with no key; reminders for assignees.

**Accepts when:** accepted by the owner, and this epic rewritten from it.

#### 📋 12.2 — Membership (outline)

**Goal:** a list has an owner and members, and access follows.

**Design:** §21. **Depends on:** 12.1.

**Technical:** a `list_member` table; the check of 13.2 becomes membership; per-account settings moved. The two-account tests gain a third role.

**Accepts when:** set by the RFC.

#### 📋 12.3 — Sharing a list (outline)

**Goal:** add and remove members, leave, and transfer ownership.

**Design:** §21. **Depends on:** 12.2.

**Technical:** the owner shares and unshares; a member can leave; transfer is one transaction; `People` handles a deleted owner (to the longest-standing member, or removed) and a deleted member.

**Accepts when:** set by the RFC.

#### 📋 12.4 — Assignment (outline)

**Goal:** assign a task to a member.

**Design:** §21. **Depends on:** 12.3.

**Technical:** `assignee_id`; removing a member clears theirs; a notification on assignment (8.1); reminders go to the assignee, or the owner if nobody.

**Accepts when:** set by the RFC.
