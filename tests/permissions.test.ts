/**
 * Role predicates — the role × permission matrix, pinned.
 *
 * Pure logic suite (no DOM, on purpose — see tests/harness.ts "When NOT to
 * use it"): the matrix is the policy contract the app's hooks are built on,
 * so any change to a predicate shows up here as a one-line diff first.
 *
 * Matrix (mirrors the role ladder in src/lib/useAuth.ts):
 *   dev, admin                          — account owners: everything
 *   general_manager                     — finance administration only
 *   staff, econome (and no session)     — baseline, nothing gated
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AppRole } from '../src/lib/useAuth';
import { canEditScholarship, canManageUsers, canWriteFinance } from '../src/lib/permissions';

const ROLES: AppRole[] = ['dev', 'admin', 'general_manager', 'staff', 'econome'];

describe('canManageUsers — dev/admin only', () => {
  it('grants the account-owner pair', () => {
    assert.equal(canManageUsers('admin'), true);
    assert.equal(canManageUsers('dev'), true);
  });
  it('denies every other role and no-session values', () => {
    for (const role of ['general_manager', 'staff', 'econome'] as AppRole[]) {
      assert.equal(canManageUsers(role), false, `${role} must not manage users`);
    }
    assert.equal(canManageUsers(null), false);
    assert.equal(canManageUsers(undefined), false);
  });
});

describe('canEditScholarship — finance-management roles', () => {
  it('grants dev/admin/general_manager', () => {
    for (const role of ['dev', 'admin', 'general_manager'] as AppRole[]) {
      assert.equal(canEditScholarship(role), true, `${role} may edit scholarship discounts`);
    }
  });
  it('denies staff/econome and no-session values', () => {
    for (const role of ['staff', 'econome'] as AppRole[]) {
      assert.equal(canEditScholarship(role), false, `${role} must not edit scholarship discounts`);
    }
    assert.equal(canEditScholarship(null), false);
    assert.equal(canEditScholarship(undefined), false);
  });
});

describe('canWriteFinance — finance-management roles', () => {
  it('grants dev/admin/general_manager', () => {
    for (const role of ['dev', 'admin', 'general_manager'] as AppRole[]) {
      assert.equal(canWriteFinance(role), true, `${role} may write finance-admin records`);
    }
  });
  it('denies staff/econome and no-session values', () => {
    for (const role of ['staff', 'econome'] as AppRole[]) {
      assert.equal(canWriteFinance(role), false, `${role} must not write finance-admin records`);
    }
    assert.equal(canWriteFinance(null), false);
    assert.equal(canWriteFinance(undefined), false);
  });
});

describe('every role is classified somewhere (guard against a new role slipping through)', () => {
  it('the predicates accept all five AppRole values', () => {
    for (const role of ROLES) {
      // Never throws — a future AppRole must be handled (a ternary on the
      // literal union would let the type checker remind us; these keep the
      // runtime honest for legacy/unknown data too).
      assert.equal(typeof canManageUsers(role), 'boolean', `canManageUsers(${role})`);
      assert.equal(typeof canEditScholarship(role), 'boolean', `canEditScholarship(${role})`);
      assert.equal(typeof canWriteFinance(role), 'boolean', `canWriteFinance(${role})`);
    }
  });
});
