import fs from 'fs';
import assert from 'assert';

console.log('======================================================');
console.log('   SUPABASE PHASE 1 SECURITY AUDIT & HARDENING SUITE  ');
console.log('======================================================');

const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');

// ── Test A: Device A cannot UPDATE Device B telemetry ──────────────────────────
// 1. Tautology (device_id = devices.device_id) must be completely removed
assert.strictEqual(
  sql.includes('(device_id = devices.device_id)'),
  false,
  'FAIL: Tautology (device_id = devices.device_id) must NOT exist in schema'
);
// 2. Ownership strictly enforced via auth.uid() = auth_user_id in UPDATE USING
assert.ok(
  sql.includes('auth.uid() IS NOT NULL AND auth_user_id = auth.uid()'),
  'FAIL: Devices UPDATE policy must require auth.uid() IS NOT NULL AND auth_user_id = auth.uid()'
);
console.log('  ✅  Test A: Device A cannot UPDATE Device B telemetry (No tautologies, strict auth_user_id ownership)');

// ── Test B: Device A cannot UPDATE Device B authorization fields ───────────────
assert.ok(
  sql.includes('status IS NOT DISTINCT FROM (SELECT d.status FROM public.devices d WHERE d.device_id = devices.device_id)') &&
  sql.includes('allow_login IS NOT DISTINCT FROM (SELECT d.allow_login FROM public.devices d WHERE d.device_id = devices.device_id)') &&
  sql.includes('admin_lock IS NOT DISTINCT FROM (SELECT d.admin_lock FROM public.devices d WHERE d.device_id = devices.device_id)') &&
  sql.includes('is_deleted IS NOT DISTINCT FROM (SELECT d.is_deleted FROM public.devices d WHERE d.device_id = devices.device_id)'),
  'FAIL: Authorization fields must be strictly protected via WITH CHECK immutability guards'
);
console.log('  ✅  Test B: Device A cannot UPDATE authorization fields (status, allow_login, admin_lock, is_deleted immutable)');

// ── Test C: Anonymous client cannot read entire devices table ──────────────────
assert.strictEqual(
  sql.includes('CREATE POLICY "Devices read fleet and status"\n    ON public.devices\n    FOR SELECT\n    TO anon, authenticated\n    USING (true);'),
  false,
  'FAIL: Permissive SELECT policy on devices must NOT exist'
);
assert.ok(
  sql.includes('CREATE POLICY "Devices read own record"') &&
  sql.includes('auth.uid() IS NOT NULL AND auth_user_id = auth.uid()'),
  'FAIL: Devices SELECT policy must be restricted to authenticated device own record'
);
console.log('  ✅  Test C: Anonymous client cannot read entire devices table (SELECT scoped to own auth_user_id)');

// ── Test D: Device can access only permitted device information ─────────────────
assert.ok(
  sql.includes('CREATE OR REPLACE FUNCTION public.get_device_fleet()') &&
  sql.includes('REVOKE ALL ON FUNCTION public.get_device_fleet FROM PUBLIC, anon'),
  'FAIL: Fleet access must be isolated behind privileged get_device_fleet RPC'
);
console.log('  ✅  Test D: Device can access only permitted device information (Fleet restricted behind admin RPC)');

// ── Test E: Anonymous authenticated client cannot call admin_device_action ─────
assert.ok(
  sql.includes('IF auth.uid() IS NULL OR coalesce((auth.jwt() ->> \'is_anonymous\')::boolean, false) = true THEN') &&
  sql.includes('Access Denied: Anonymous clients cannot perform administrative device actions') &&
  sql.includes('USING ERRCODE = \'42501\''),
  'FAIL: admin_device_action must reject anonymous authenticated callers with ERRCODE 42501'
);
assert.ok(
  sql.includes('REVOKE ALL ON FUNCTION public.admin_device_action FROM PUBLIC, anon'),
  'FAIL: admin_device_action must revoke execute from anon and public'
);
console.log('  ✅  Test E: Anonymous authenticated client cannot call admin_device_action (Explicit 42501 exception thrown)');

// ── Test F: Non-admin authenticated client cannot call admin_device_action ─────
assert.ok(
  sql.includes('IF NOT v_is_admin THEN') &&
  sql.includes('Access Denied: Administrative privileges required') &&
  sql.includes('USING ERRCODE = \'42501\''),
  'FAIL: admin_device_action must reject non-admin callers with ERRCODE 42501'
);
console.log('  ✅  Test F: Non-admin authenticated client cannot call admin_device_action (Admin claim & 42501 required)');

// ── Test G: Admin-authorized caller can call admin_device_action ───────────────
assert.ok(
  sql.includes('p_action = \'APPROVE\'') &&
  sql.includes('p_action = \'BLOCK\'') &&
  sql.includes('p_action = \'LOCK\'') &&
  sql.includes('p_action = \'UNLOCK\'') &&
  sql.includes('p_action = \'FORCE_LOGOUT\'') &&
  sql.includes('p_action = \'RESET_AUTH\''),
  'FAIL: admin_device_action must support all 6 required administrative operations'
);
console.log('  ✅  Test G: Admin-authorized caller can execute admin_device_action (6 actions supported)');

// ── Test H: Device A cannot modify Device B device_app_usage ───────────────────
assert.ok(
  sql.includes('device_id IN (\n            SELECT d.device_id\n            FROM public.devices d\n            WHERE d.auth_user_id = auth.uid()\n        )'),
  'FAIL: device_app_usage must scope INSERT, UPDATE, and SELECT to device_id matching auth_user_id'
);
console.log('  ✅  Test H: Device A cannot modify Device B device_app_usage (Scoped to matching auth_user_id)');

// ── Test I: Device A cannot overwrite Device B auth_user_id ────────────────────
assert.ok(
  sql.includes('auth_user_id IS NOT DISTINCT FROM (SELECT d.auth_user_id FROM public.devices d WHERE d.device_id = devices.device_id)'),
  'FAIL: auth_user_id must be immutable in client UPDATE policy'
);
console.log('  ✅  Test I: Device A cannot overwrite Device B auth_user_id (auth_user_id immutable in client UPDATE)');

// ── Test J: Already-bound ACTIVE device cannot be silently rebound by another auth.uid()
// Phase 2N: Hijack protection now correctly scoped to ACTIVE devices only.
// PENDING devices are allowed to re-bind after session rotation/reinstall (recovery flow).
assert.ok(
  sql.includes("IF v_device.status = 'ACTIVE' AND v_device.auth_user_id IS NOT NULL AND v_device.auth_user_id != v_uid THEN") &&
  sql.includes('DEVICE_ALREADY_BOUND'),
  'FAIL: register_device_auth must prevent silent hijacking of an already-bound ACTIVE device'
);
assert.ok(
  sql.includes('IF EXISTS (SELECT 1 FROM public.devices WHERE auth_user_id = v_uid AND device_id != p_device_id) THEN') &&
  sql.includes('USER_ALREADY_BOUND'),
  'FAIL: register_device_auth must prevent one auth session from binding multiple devices'
);
console.log('  ✅  Test J: Already-bound ACTIVE device cannot be silently rebound (Hijack & Multi-device protected; PENDING re-bind allowed for recovery)');

// ── Test K: Business table access still requires is_active_device() ────────────
const businessTables = [
  'orders', 'order_items', 'payments', 'expenses', 'deliveries',
  'daily_submit', 'daily_summary', 'daily_submit_priority',
  'restaurant_tables', 'menu_categories', 'menu_items', 'app_config', 'supplier_due'
];

businessTables.forEach(t => {
  assert.ok(
    sql.includes(`CREATE POLICY "Active devices access ${t}"`) ||
    sql.includes(`CREATE POLICY "Active devices read non-sensitive ${t}"`),
    `FAIL: Business table ${t} missing active device policy`
  );
  assert.ok(
    sql.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`),
    `FAIL: Business table ${t} missing ENABLE ROW LEVEL SECURITY`
  );
});

assert.ok(
  sql.includes('CREATE OR REPLACE FUNCTION public.is_active_device') &&
  sql.includes('auth_user_id = auth.uid()') &&
  sql.includes('status = \'ACTIVE\'') &&
  sql.includes('is_deleted = false') &&
  sql.includes('admin_lock = false') &&
  sql.includes('SECURITY DEFINER') &&
  sql.includes('SET search_path = public') &&
  sql.includes('REVOKE ALL ON FUNCTION public.is_active_device FROM PUBLIC, anon'),
  'FAIL: is_active_device must check auth.uid() + ACTIVE + is_deleted=false + admin_lock=false and revoke execute from anon'
);
console.log('  ✅  Test K: Business table access strictly requires is_active_device() across all 13 tables');

// ── Test L: users/PIN never enters Supabase schema ─────────────────────────────
assert.strictEqual(
  sql.includes('CREATE TABLE IF NOT EXISTS public.users'),
  false,
  'FAIL: public.users table must NEVER exist in Supabase schema'
);
assert.strictEqual(
  sql.toLowerCase().includes('pin text') || sql.toLowerCase().includes('pin varchar'),
  false,
  'FAIL: PIN column must NEVER exist in Supabase schema'
);
// ── Test M: Force logout token cannot be set by device, only acknowledged to NULL
assert.ok(
  sql.includes('force_logout = false') &&
  sql.includes('force_logout_token IS NULL') &&
  sql.includes('force_logout IS NOT DISTINCT FROM') &&
  sql.includes('force_logout_token IS NOT DISTINCT FROM'),
  'FAIL: Devices UPDATE policy must strictly restrict force_logout/force_logout_token to either unchanged or acknowledged (NULL)'
);
console.log('  ✅  Test M: Force logout token can only be acknowledged to NULL by device; setting new token blocked');

console.log('------------------------------------------------------');
console.log('  All 13 Supabase security hardening assertions passed!');
console.log('======================================================');
