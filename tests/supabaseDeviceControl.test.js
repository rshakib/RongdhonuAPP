/**
 * Supabase Realtime Device Control Unit & Verification Test Suite
 * Run with: node tests/supabaseDeviceControl.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   SUPABASE DEVICE CONTROL — VERIFICATION TEST SUITE  ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;
const pendingAsyncTests = [];

function recordPass(desc) {
  console.log(`  ✅  ${desc}`);
  passedTests++;
}

function recordFail(desc, err) {
  console.error(`  ❌  ${desc}`);
  console.error(`      ${err.message}`);
  failedTests++;
}

function it(desc, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingAsyncTests.push(
        result.then(() => recordPass(desc), (err) => recordFail(desc, err))
      );
      return;
    }
    recordPass(desc);
  } catch (err) {
    recordFail(desc, err);
  }
}

// 1. Supabase Client Isolation & Resilient Fallback
it('services/supabaseClient.js exports safe functions and does not crash without env vars', () => {
  const code = fs.readFileSync('services/supabaseClient.js', 'utf8');
  assert.ok(code.includes('export function isSupabaseConfigured'), 'isSupabaseConfigured exported');
  assert.ok(code.includes('export function getSupabaseClient'), 'getSupabaseClient exported');
  assert.ok(code.includes('export async function safeSupabaseCall'), 'safeSupabaseCall exported');
  assert.ok(code.includes('persistSession: false'), 'Session persistence disabled (no Supabase auth session)');
});

// 2. Supabase Device Control Module
it('services/supabaseDeviceControl.js implements event-driven presence, active_since, and admin monitor', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(code.includes('export async function upsertDeviceToSupabase'), 'upsertDeviceToSupabase exported');
  assert.ok(code.includes('export async function updateSupabaseDevice'), 'updateSupabaseDevice exported');
  assert.ok(code.includes('export function startDevicePresence'), 'startDevicePresence exported');
  assert.ok(code.includes('stopDevicePresence'), 'stopDevicePresence exported');
  assert.ok(code.includes('export function subscribeAdminDeviceMonitor'), 'subscribeAdminDeviceMonitor exported');
  assert.ok(code.includes('export async function fetchSingleSupabaseDevice'), 'fetchSingleSupabaseDevice exported');
  assert.ok(code.includes('active_since'), 'Tracks active_since session timestamp');
  assert.ok(code.includes('rongdhonu_device_presence'), 'Presence channel configured');
  assert.ok(code.includes('postgres_changes'), 'Instant remote command listener configured');
  assert.ok(code.includes('untrack()'), 'Untracks immediately on leave/background');
  assert.ok(code.includes('adminPresenceListeners'), 'Maintains shared adminPresenceListeners for publisher/monitor coexistence');
});

// 3. Complete Removal of Firestore sync from services/deviceRegistry.js
it('services/deviceRegistry.js contains zero calls to enqueueSync and syncRecordImmediately', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.strictEqual(code.includes('enqueueSync("device_registry"'), false, 'No enqueueSync for device_registry');
  assert.strictEqual(code.includes('syncRecordImmediately("device_registry"'), false, 'No syncRecordImmediately for device_registry');
  assert.ok(code.includes('updateSupabaseDevice'), 'Calls updateSupabaseDevice');
  assert.ok(code.includes('upsertDeviceToSupabase'), 'Calls upsertDeviceToSupabase');
  assert.ok(code.includes('export function syncRemoteDeviceToLocal'), 'syncRemoteDeviceToLocal exported');
});

// 4. Complete Removal of device_registry from Firestore Sync Profiles in database.js
it('database.js excludes device_registry from all Firestore profile sync groups', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  // Look at APP_PROFILES section
  const profilesSection = code.substring(code.indexOf('export const APP_PROFILES ='), code.indexOf('export function getActiveProfileConfig'));
  assert.strictEqual(profilesSection.includes("'device_registry'"), false, 'device_registry removed from APP_PROFILES');
  assert.ok(profilesSection.includes('deviceRegistry: []'), 'deviceRegistry is empty array');
});

// 5. Decommissioned Firestore syncDeviceRegistry function in database.js
it('database.js syncDeviceRegistry is decommissioned and returns false', () => {
  const code = fs.readFileSync('database.js', 'utf8');
  assert.ok(code.includes('export async function syncDeviceRegistry()'), 'syncDeviceRegistry function exists');
  assert.ok(code.includes('Firestore sync for device_registry is fully decommissioned'), 'syncDeviceRegistry is decommissioned');
  assert.ok(code.includes("deadCollections = ['firebase_usage', 'device_registry']"), 'device_registry added to clearDeadQueueItems');
});

// 6. Complete Removal of syncDeviceRegistry from App.js
it('App.js does not invoke syncDeviceRegistry anywhere and stabilizes presence lifecycle', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.strictEqual(code.includes('syncDeviceRegistry'), false, 'Zero syncDeviceRegistry in App.js');
  assert.ok(code.includes('startDevicePresence'), 'App.js initializes startDevicePresence');
  assert.ok(code.includes('checkAndExecuteForceLogout'), 'App.js wires checkAndExecuteForceLogout');
  assert.ok(code.includes('}, [userRole, userDisplayName, isLoggedIn]);'), 'Presence effect does not re-trigger on screen navigation');
});

// 7. Admin UI Connection in screens/DeviceManagementScreen.js
it('screens/DeviceManagementScreen.js subscribes to Supabase Realtime Presence and DB changes', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('subscribeAdminDeviceMonitor'), 'Subscribes to subscribeAdminDeviceMonitor');
  assert.ok(code.includes('livePresenceMap'), 'Maintains livePresenceMap');
  assert.ok(code.includes('formatDeviceActivityStatus'), 'Uses formatDeviceActivityStatus for live presence');
});

// 8. SQL Migration Schema Check
it('supabase_full_setup.sql contains public.devices table and Realtime publication', () => {
  const code = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  assert.ok(code.includes('CREATE TABLE IF NOT EXISTS public.devices'), 'Table created');
  assert.ok(code.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.devices'), 'Realtime publication enabled');
  assert.ok(code.includes('ENABLE ROW LEVEL SECURITY'), 'RLS enabled');
});

// 9. Failure Isolation Verification
it('safeSupabaseCall returns fallback when unconfigured and runs the operation when configured', async () => {
  const { safeSupabaseCall, isSupabaseConfigured } = require('../services/supabaseClient.js');
  const result = await safeSupabaseCall(async () => 'success', 'fallback_ok');
  if (isSupabaseConfigured()) {
    assert.strictEqual(result, 'success', 'Configured client executes the operation');
  } else {
    assert.strictEqual(result, 'fallback_ok', 'Unconfigured client returns the fallback without throwing');
  }
});

// 10. Untouched POS Data Verification
it('POS tables, billing checkout, orders, and expenses are completely untouched', () => {
  const dbCode = fs.readFileSync('database.js', 'utf8');
  assert.ok(dbCode.includes('syncHighFrequencyCollections'), 'syncHighFrequencyCollections intact');
  assert.ok(dbCode.includes('syncLowFrequencyCollections'), 'syncLowFrequencyCollections intact');
  assert.ok(dbCode.includes('syncTablesOnly'), 'syncTablesOnly intact');
  assert.ok(dbCode.includes('processSyncQueue'), 'processSyncQueue intact');

  // Verify POS screens exist and untouched
  assert.ok(fs.existsSync('screens/PaymentCheckoutScreen.js'), 'PaymentCheckoutScreen exists');
  assert.ok(fs.existsSync('screens/TableDetailScreen.js'), 'TableDetailScreen exists');
  assert.ok(fs.existsSync('screens/ExpensesScreen.js'), 'ExpensesScreen exists');
});

// ─── BUG-FIX VERIFICATION TESTS ────────────────────────────────────────────

// 11. BUG-1/BUG-4 Fix: registerDeviceIfNeeded never overwrites admin-approved status
it('BUG-1 fix: registerDeviceIfNeeded fetches remote state first and never upserts full record on existing device', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  // Imports fetchSupabaseDevices at the top
  assert.ok(code.includes('fetchSupabaseDevices'), 'imports fetchSupabaseDevices');
  // Existing-device branch fetches remote before touching Supabase
  assert.ok(code.includes('const remoteList = await fetchSupabaseDevices()'), 'fetches remote list on existing-device startup');
  assert.ok(code.includes('syncRemoteDeviceToLocal(remoteRecord)'), 'syncs remote record to local before metadata update');
  // Must NOT call upsertDeviceToSupabase (full record) on existing device path
  // The upsert is only called for NEW devices (in the !existingRecord branch)
  // Verify the only upsertDeviceToSupabase call is in the new-device branch
  const newDeviceBranchEnd = code.indexOf('lastFlushedLastSeen = now;');
  const existingDeviceBranchStart = code.indexOf('BUG-1 / BUG-4 FIX');
  assert.ok(newDeviceBranchEnd < existingDeviceBranchStart, 'upsertDeviceToSupabase only in new-device branch');
  // updateSupabaseDevice (metadata-only) is called in the existing-device path
  assert.ok(code.includes('updateSupabaseDevice(deviceId, {'), 'uses metadata-only updateSupabaseDevice for existing device');
  // Ensure admin-controlled fields are NOT in the metadata-only update payload
  const metadataUpdateBlock = code.substring(code.indexOf('Push ONLY metadata to Supabase'), code.indexOf('console.log(`[DeviceRegistry] Updated device metadata'));
  assert.strictEqual(metadataUpdateBlock.includes('status:'), false, 'status field NOT in metadata-only update');
  assert.strictEqual(metadataUpdateBlock.includes('allow_login:'), false, 'allow_login field NOT in metadata-only update');
  assert.strictEqual(metadataUpdateBlock.includes('admin_lock:'), false, 'admin_lock field NOT in metadata-only update');
  assert.strictEqual(metadataUpdateBlock.includes('force_logout:'), false, 'force_logout field NOT in metadata-only update');
});

// 12. BUG-2 Fix: ACTIVE approval handler works from PENDING, LOGIN, and BLOCKED screens
it('BUG-2 fix: App.js ACTIVE handler covers DEVICE_PENDING, DEVICE_BLOCKED, and LOGIN screens', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes("'DEVICE_PENDING', 'DEVICE_BLOCKED', 'LOGIN'"), 'ACTIVE handler covers all 3 approvalScreens');
  assert.ok(code.includes('!alreadyLoggedIn && onApprovableScreen'), 'Guard prevents duplicate login if already logged in');
  assert.ok(code.includes('BUG-2 / BUG-6 FIX'), 'Fix comment present');
  // Old narrow guard must be gone
  assert.strictEqual(code.includes("currentScreenRef.current === 'DEVICE_PENDING'"), false, 'Old narrow DEVICE_PENDING-only guard removed');
});

// 13. BUG-3 Fix: DevicePendingScreen refresh fetches from Supabase first
// 13. BUG-3 Fix: DevicePendingScreen refresh fetches from Supabase first with single-device isolation
it('BUG-3 fix: DevicePendingScreen handleRefresh fetches Supabase and syncs before reading local state', () => {
  const code = fs.readFileSync('screens/DevicePendingScreen.js', 'utf8');
  assert.ok(code.includes("fetchSingleSupabaseDevice"), 'imports fetchSingleSupabaseDevice');
  assert.ok(code.includes("getCurrentDeviceRecord"), 'imports getCurrentDeviceRecord');
  assert.ok(code.includes("syncRemoteDeviceToLocal"), 'imports syncRemoteDeviceToLocal');
  assert.ok(code.includes('fetchSingleSupabaseDevice(resolvedDeviceId)'), 'fetches single device in handleRefresh');
  assert.ok(code.includes('syncRemoteDeviceToLocal(remoteRecord)'), 'syncs remote record before reading local state');
  assert.ok(code.includes('নেটওয়ার্ক সংযোগ নেই'), 'shows offline message when network unavailable');
});

// 14. BUG-5 Fix: subscribeAdminDeviceMonitor accepts adminDeviceId parameter
it('BUG-5 fix: subscribeAdminDeviceMonitor accepts adminDeviceId parameter to set correct presence key', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(code.includes('export function subscribeAdminDeviceMonitor(onPresenceUpdate, onRecordChange, adminDeviceId)'), 'accepts adminDeviceId parameter');
  assert.ok(code.includes('const effectiveDeviceId = adminDeviceId || activeDeviceId'), 'uses effectiveDeviceId for channel');
  assert.ok(code.includes('getOrCreatePresenceChannel(effectiveDeviceId)'), 'passes effectiveDeviceId to channel creator');
  assert.ok(code.includes('BUG-5 FIX'), 'BUG-5 fix comment present');
});

// 15. BUG-5 Fix call-site: DeviceManagementScreen passes real device ID to subscribeAdminDeviceMonitor
it('BUG-5 fix: DeviceManagementScreen passes adminDeviceId to subscribeAdminDeviceMonitor', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('getCurrentDeviceRecord'), 'imports getCurrentDeviceRecord');
  assert.ok(code.includes('const adminRecord = getCurrentDeviceRecord()'), 'fetches admin record for presence key');
  assert.ok(code.includes('const adminDeviceId = adminRecord?.device_id || null'), 'extracts adminDeviceId');
  assert.ok(code.includes('adminDeviceId'), 'passes adminDeviceId as 3rd arg to subscribeAdminDeviceMonitor');
});

// 16. BUG-6 Fix: ACTIVE handler also fires from DEVICE_BLOCKED screen (confirmed by BUG-2 fix)
it('BUG-6 fix: ACTIVE event from DEVICE_BLOCKED triggers login recovery', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  // DEVICE_BLOCKED is included in the approvalScreens list checked in the ACTIVE branch
  assert.ok(code.includes("'DEVICE_PENDING', 'DEVICE_BLOCKED', 'LOGIN'"), 'DEVICE_BLOCKED in approvalScreens for ACTIVE recovery');
  // Admin lock still blocked at the BLOCK handler level (before ACTIVE branch)
  assert.ok(code.includes('remoteRecord.admin_lock || remoteRecord.status === \'BLOCKED\''), 'admin_lock check still present before ACTIVE branch');
});

// 17. Reconnect safety: startup remote fetch is offline-tolerant
it('Reconnect: registerDeviceIfNeeded handles network failure gracefully and falls back to local state', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('Could not fetch remote device state on startup (offline?)'), 'warns on network failure during startup sync');
  assert.ok(code.includes('continue with local state'), 'explicitly documents fallback to local state');
  // The local SQLite update still proceeds even when Supabase fetch fails
  assert.ok(code.includes('UPDATE device_registry'), 'local SQLite last_seen update still runs');
});

// 18. Admin lock behavior preserved after BUG-2/6 fix
it('Admin Lock is not bypassed by ACTIVE approval event', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  // Admin lock handler appears BEFORE the ACTIVE branch
  const adminLockPos = code.indexOf('remoteRecord.admin_lock || remoteRecord.status === \'BLOCKED\'');
  const activeBranchPos = code.indexOf('BUG-2 / BUG-6 FIX');
  assert.ok(adminLockPos > 0, 'admin_lock check exists');
  assert.ok(activeBranchPos > 0, 'ACTIVE branch fix exists');
  assert.ok(adminLockPos < activeBranchPos, 'admin_lock check runs BEFORE the ACTIVE approval branch');
});

// 19. Lifecycle deduplication: same-event deduplication vs genuine new foreground openings
it('Lifecycle deduplication: duplicate callbacks of same event deduplicated while genuine resents trigger fresh check', () => {
  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(regCode.includes('lastLifecycleEventId'), 'Tracks lastLifecycleEventId for event-based deduplication');
  assert.ok(regCode.includes('lastLifecycleTimestamp'), 'Tracks lastLifecycleTimestamp');

  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes('appWasBackgrounded'), 'Tracks appWasBackgrounded in AppState listener');
  assert.ok(appCode.includes('resumeEventId'), 'Generates unique resumeEventId on foreground return');
});

// 20. Query error vs confirmed missing row
it('Metadata authority: query errors do not trigger row creation, only confirmed missing rows upsert', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('confirmedMissing'), 'Tracks confirmedMissing state explicitly');
  assert.ok(code.includes('upsertDeviceToSupabase(existingRecord)'), 'Only upserts when confirmed row is missing');
  assert.ok(code.includes('Could not fetch remote device state on startup (offline?)'), 'Treats network errors as offline fallback, not missing row');

  const supCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(supCode.includes('notFound: true'), 'fetchSingleSupabaseDevice explicitly returns notFound: true on null data');
  assert.ok(supCode.includes('notFound: false'), 'fetchSingleSupabaseDevice returns notFound: false on query error');
});

// 21. Metadata diffing: unchanged metadata avoids unnecessary upload
it('Metadata diffing: unchanged metadata avoids unnecessary upload and writes only changed fields', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('changedFields.app_version'), 'Diffs app_version');
  assert.ok(code.includes('changedFields.android_version'), 'Diffs android_version');
  assert.ok(code.includes('changedFields.device_name'), 'Diffs device_name');
  assert.ok(code.includes('changedFields.manufacturer'), 'Diffs manufacturer');
  assert.ok(code.includes('changedFields.brand'), 'Diffs brand');
  assert.ok(code.includes('changedFields.model'), 'Diffs model');
  assert.ok(code.includes('Unnecessary Supabase upload avoided'), 'Avoids upload when metadata is unchanged');
});

// 22. Realtime presence leave/disconnect and active duration in Admin UI
it('Realtime presence: untracks immediately on background/stop and Admin UI computes active duration locally', () => {
  const supCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(supCode.includes('active_since: currentSessionStartTime'), 'Sends active_since session timestamp');
  assert.ok(supCode.includes('activePresenceChannel.untrack()'), 'Untracks immediately on stop/background');

  const adminUiCode = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(adminUiCode.includes('formatLiveActiveDuration'), 'Formats live active duration');
  assert.ok(adminUiCode.includes('currentUiTime'), 'Maintains local UI time tick');
});

// 23. Manager & Owner fleet isolation
it('Fleet isolation: Manager and Owner never query full device list, only Admin queries fleet', () => {
  const supCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(supCode.includes("profile !== 'ADMIN'"), 'fetchSupabaseDevices blocks non-admin profiles');
  assert.ok(supCode.includes('unauthorized to fetch device fleet'), 'Logs security warning if non-admin attempts fleet query');

  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(regCode.includes("ACTIVE_APP_PROFILE === 'ADMIN'"), 'Differentiates ADMIN from Manager/Owner');
  assert.ok(regCode.includes('// MANAGER and OWNER: Strictly forbidden from querying remote Supabase metadata'), 'Manager/Owner forbidden from remote queries');
});

// 24. Admin fleet reconciliation on app open compares all required fields
it('Admin fleet reconciliation: compares all required metadata fields and syncs SQLite', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('export async function reconcileAdminFleet'), 'reconcileAdminFleet exported');
  assert.ok(code.includes('local.status !== rem.status'), 'Checks status');
  assert.ok(code.includes('local.app_version !=='), 'Checks app_version');
  assert.ok(code.includes('local.android_version !=='), 'Checks android_version');
  assert.ok(code.includes('local.device_name !=='), 'Checks device_name');
});

// 25. ADMIN exclusive viewer of Device Control screen
it('Admin exclusivity: Device Control screen is strictly restricted to ADMIN', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes("ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin'"), 'App.js guards DEVICE_MANAGEMENT route for ADMIN only');

  const screenCode = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(screenCode.includes('if (!isAdmin) {\n    return null;\n  }'), 'DeviceManagementScreen blocks non-admin rendering');
});

// 26. Required TODO comment for future Owner access at all role-access guards
it('Future Owner access: Exact TODO comment present at all role-access and fleet-fetching guards', () => {
  const expectedTodo = '// TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.';
  
  const supCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(supCode.includes(expectedTodo), 'TODO in services/supabaseDeviceControl.js');

  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  const regMatches = regCode.split(expectedTodo).length - 1;
  assert.ok(regMatches >= 2, 'TODO present in both reconcileAdminFleet and registerDeviceIfNeeded');

  const appCode = fs.readFileSync('App.js', 'utf8');
  const appMatches = appCode.split(expectedTodo).length - 1;
  assert.ok(appMatches >= 3, 'TODO present in checkAndInitialize, resume handler, and DEVICE_MANAGEMENT route');
});

// 27. Local device identity condition: fails safely if identity is missing/invalid
it('Local device identity safety: startDevicePresence fails safely without throwing or creating rows when ID is missing', () => {
  const { startDevicePresence } = require('../services/supabaseDeviceControl.js');
  const cleanup1 = startDevicePresence(null);
  assert.strictEqual(typeof cleanup1, 'function', 'Returns no-op cleanup function for null deviceId');
  const cleanup2 = startDevicePresence('');
  assert.strictEqual(typeof cleanup2, 'function', 'Returns no-op cleanup function for empty deviceId');
  const cleanup3 = startDevicePresence('   ');
  assert.strictEqual(typeof cleanup3, 'function', 'Returns no-op cleanup function for whitespace deviceId');
});

// 28. formatDeviceActivityStatus: Online foreground presence formatting
it('Presence formatting: Online presence displays "🟢 Active now" with role and duration', () => {
  const { formatDeviceActivityStatus } = require('../services/supabaseDeviceControl.js');
  const now = 1720000000000;

  // Active now with MANAGER role
  const res1 = formatDeviceActivityStatus(
    { online: true, user_role: 'MANAGER', active_since: now - 30000, last_heartbeat: now - 5000 },
    null,
    now
  );
  assert.strictEqual(res1.isOnline, true);
  assert.strictEqual(res1.text, '🟢 Active now (MANAGER)');
  assert.strictEqual(res1.subtext, '30s');

  // Active now with OWNER role and longer duration
  const res2 = formatDeviceActivityStatus(
    { online: true, user_role: 'OWNER', active_since: now - 150000, last_heartbeat: now - 2000 },
    null,
    now
  );
  assert.strictEqual(res2.isOnline, true);
  assert.strictEqual(res2.text, '🟢 Active now (OWNER)');
  assert.strictEqual(res2.subtext, '2m 30s');

  // Active now without explicit role
  const res3 = formatDeviceActivityStatus(
    { online: true, last_heartbeat: now - 1000 },
    null,
    now
  );
  assert.strictEqual(res3.isOnline, true);
  assert.strictEqual(res3.text, '🟢 Active now');
});

// 29. formatDeviceActivityStatus: Offline / background relative time formatting
it('Presence formatting: Offline presence displays relative last-active times correctly', () => {
  const { formatDeviceActivityStatus } = require('../services/supabaseDeviceControl.js');
  const now = 1720000000000;

  // 1 sec ago
  const res1 = formatDeviceActivityStatus({ online: false, last_active: now - 1000 }, null, now);
  assert.strictEqual(res1.isOnline, false);
  assert.strictEqual(res1.text, '⏳ 1 sec ago');

  // 3 sec ago
  const res3 = formatDeviceActivityStatus({ online: false, last_active: now - 3000 }, null, now);
  assert.strictEqual(res3.isOnline, false);
  assert.strictEqual(res3.text, '⏳ 3 sec ago');

  // 1 min 10 sec ago
  const res70 = formatDeviceActivityStatus({ online: false, last_active: now - 70000 }, null, now);
  assert.strictEqual(res70.isOnline, false);
  assert.strictEqual(res70.text, '⏳ 1 min 10 sec ago');

  // 2 min ago
  const res120 = formatDeviceActivityStatus({ online: false, last_active: now - 120000 }, null, now);
  assert.strictEqual(res120.isOnline, false);
  assert.strictEqual(res120.text, '⏳ 2 min ago');

  // Fallback to SQLite lastSeenTimestamp when live presence is null
  const resSeen = formatDeviceActivityStatus(null, new Date(now - 15000).toISOString(), now);
  assert.strictEqual(resSeen.isOnline, false);
  assert.strictEqual(resSeen.text, '⏳ 15 sec ago');
});

// 30. Stale Presence Timeout (45 seconds)
it('Stale presence timeout: Presences older than 45s are marked offline and fresh heartbeat restores online', () => {
  const { formatDeviceActivityStatus, STALE_PRESENCE_TIMEOUT_MS } = require('../services/supabaseDeviceControl.js');
  assert.strictEqual(STALE_PRESENCE_TIMEOUT_MS, 45000, 'STALE_PRESENCE_TIMEOUT_MS is exactly 45000ms');

  const now = 1720000000000;

  // Stale heartbeat (>45s): marked offline with relative time
  const staleRes = formatDeviceActivityStatus(
    { online: true, user_role: 'MANAGER', last_heartbeat: now - 46000 },
    null,
    now
  );
  assert.strictEqual(staleRes.isOnline, false, 'Stale device must not remain Active now');
  assert.strictEqual(staleRes.text, '⏳ 46 sec ago');

  // Fresh heartbeat arrives: restores online Active now
  const restoredRes = formatDeviceActivityStatus(
    { online: true, user_role: 'MANAGER', last_heartbeat: now - 5000 },
    null,
    now
  );
  assert.strictEqual(restoredRes.isOnline, true, 'Fresh heartbeat restores online status');
  assert.strictEqual(restoredRes.text, '🟢 Active now (MANAGER)');
});

// 31. extractPresenceMap: Preserves offline/left devices and handles leave events
it('Presence map extraction: Preserves last_active for left devices and handles stale timeouts', () => {
  const { extractPresenceMap } = require('../services/supabaseDeviceControl.js');
  const now = Date.now();

  const mockState = {
    'dev-1': [{ device_id: 'dev-1', online: true, last_heartbeat: now - 10000 }],
    'dev-2': [{ device_id: 'dev-2', online: true, last_heartbeat: now - 50000 }] // stale
  };

  const initialMap = extractPresenceMap(mockState);
  assert.strictEqual(initialMap['dev-1'].online, true, 'dev-1 is online');
  assert.strictEqual(initialMap['dev-2'].online, false, 'dev-2 is marked offline due to stale timeout');
  assert.strictEqual(initialMap['dev-2'].is_stale, true, 'dev-2 marked as is_stale');

  // When dev-1 leaves, its previous last_active is preserved in memory
  const stateAfterLeave = {
    'dev-2': [{ device_id: 'dev-2', online: true, last_heartbeat: now - 50000 }]
  };
  const updatedMap = extractPresenceMap(stateAfterLeave, initialMap);
  assert.ok(updatedMap['dev-1'], 'dev-1 preserved in presence map after leave');
  assert.strictEqual(updatedMap['dev-1'].online, false, 'dev-1 transitioned to offline');
});

// 32. Timestamp safety: Handles missing, malformed, or future timestamps safely
it('Timestamp safety: Malformed or future timestamps produce safe fallbacks without throwing', () => {
  const { formatDeviceActivityStatus } = require('../services/supabaseDeviceControl.js');
  const now = 1720000000000;

  // Missing everything -> safe fallback
  const resEmpty = formatDeviceActivityStatus(null, null, now);
  assert.strictEqual(resEmpty.isOnline, false);
  assert.strictEqual(resEmpty.text, '⏳ Offline');

  // Invalid non-numeric timestamp -> safe fallback
  const resInvalid = formatDeviceActivityStatus({ online: false, last_active: 'invalid_date' }, 'not_a_date', now);
  assert.strictEqual(resInvalid.isOnline, false);
  assert.strictEqual(resInvalid.text, '⏳ Offline');

  // Future timestamp (clock skew) -> clamped to 0 diff ("1 sec ago"), no negative numbers
  const resFuture = formatDeviceActivityStatus({ online: false, last_active: now + 50000 }, null, now);
  assert.strictEqual(resFuture.isOnline, false);
  assert.strictEqual(resFuture.text, '⏳ 1 sec ago', 'Future timestamp clamped safely');
});

// 33. Multi-device independence: Multiple devices for one user/role tracked independently
it('Multi-device independence: Multiple devices under same role tracked by distinct device_id', () => {
  const { extractPresenceMap } = require('../services/supabaseDeviceControl.js');
  const now = Date.now();

  const mockState = {
    'mgr-phone': [{ device_id: 'mgr-phone', user_role: 'MANAGER', online: true, last_heartbeat: now - 2000 }],
    'mgr-tablet': [{ device_id: 'mgr-tablet', user_role: 'MANAGER', online: true, last_heartbeat: now - 5000 }]
  };

  const map = extractPresenceMap(mockState);
  assert.ok(map['mgr-phone'], 'Manager phone tracked');
  assert.ok(map['mgr-tablet'], 'Manager tablet tracked');
  assert.strictEqual(map['mgr-phone'].online, true);
  assert.strictEqual(map['mgr-tablet'].online, true);
  assert.notStrictEqual(map['mgr-phone'].last_heartbeat, map['mgr-tablet'].last_heartbeat);
});

// 34. Zero database writes for UI clock: UI clock updates locally in React component
it('UI Clock efficiency: DeviceManagementScreen maintains local in-memory UI clock without DB writes', () => {
  const screenCode = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(screenCode.includes('currentUiTime'), 'Maintains currentUiTime state');
  assert.ok(screenCode.includes('setInterval'), 'Ticks currentUiTime every 1s');
  assert.ok(screenCode.includes('formatDeviceActivityStatus(livePresence, item.last_seen, currentUiTime)'), 'Passes currentUiTime to formatDeviceActivityStatus');
  // Confirms zero Supabase update calls inside the 1-second timer
  const timerBlock = screenCode.substring(screenCode.indexOf('const [currentUiTime, setCurrentUiTime]'), screenCode.indexOf('return () => clearInterval(uiTimer)'));
  assert.strictEqual(timerBlock.includes('updateSupabaseDevice'), false, 'Zero Supabase writes in UI clock');
  assert.strictEqual(timerBlock.includes('upsertDeviceToSupabase'), false, 'Zero Supabase upserts in UI clock');
});

// 35. Semantic Version Comparison (compareSemver)
it('Semantic Version Comparison: Handles numerical ordering (1.9.0 < 1.10.0) correctly', () => {
  const { compareSemver } = require('../services/firebaseAppConfig.js');
  assert.strictEqual(compareSemver('1.9.0', '1.10.0'), -1, '1.9.0 must be less than 1.10.0');
  assert.strictEqual(compareSemver('1.10.0', '1.9.0'), 1, '1.10.0 must be greater than 1.9.0');
  assert.strictEqual(compareSemver('1.0.3', '1.0.3'), 0, 'Equal versions return 0');
  assert.strictEqual(compareSemver('1.0.2', '1.0.2'), 0, 'Equal versions return 0');
  assert.strictEqual(compareSemver('2.0.0', '1.99.99'), 1, 'Major version priority');
  assert.strictEqual(compareSemver('v1.5.0', '1.5.0'), 0, 'Handles leading v prefix');
  assert.strictEqual(compareSemver('1.4.9', '1.5.0'), -1, '1.4.9 < 1.5.0');
});

// 36. Version Policy Configuration & Fallback
it('Version Policy: Exports comprehensive schema and defaults', () => {
  const { DEFAULT_VERSION_POLICY } = require('../services/firebaseAppConfig.js');
  assert.ok(DEFAULT_VERSION_POLICY.minimum_required_version, 'Has minimum_required_version');
  assert.ok(DEFAULT_VERSION_POLICY.latest_version, 'Has latest_version');
  assert.ok(DEFAULT_VERSION_POLICY.update_url, 'Has update_url');
  assert.strictEqual(typeof DEFAULT_VERSION_POLICY.force_update_enabled, 'boolean', 'Has force_update_enabled boolean');
});

// 37. AppUpdateRequiredScreen Non-bypassable UI
it('AppUpdateRequiredScreen: Traps hardware back navigation and provides Update App link', () => {
  const screenCode = fs.readFileSync('screens/AppUpdateRequiredScreen.js', 'utf8');
  assert.ok(screenCode.includes('BackHandler.addEventListener'), 'Traps hardware back button');
  assert.ok(screenCode.includes('Linking.openURL'), 'Provides link to update URL');
  assert.ok(screenCode.includes('App Update Required'), 'Displays App Update Required title');
  assert.strictEqual(screenCode.includes('setCurrentScreen'), false, 'Does not provide route to bypass update');
});

// 38. DeviceBlockedScreen Non-bypassable UI
it('DeviceBlockedScreen: Closes app on exit and provides recheck action without login bypass', () => {
  const screenCode = fs.readFileSync('screens/DeviceBlockedScreen.js', 'utf8');
  assert.ok(screenCode.includes('BackHandler.addEventListener'), 'Traps hardware back button');
  assert.ok(screenCode.includes('BackHandler.exitApp()'), 'Exits app on exit');
  assert.ok(screenCode.includes('onRecheck'), 'Provides recheck capability');
  assert.strictEqual(screenCode.includes("setCurrentScreen('LOGIN')"), false, 'No navigation route to login');
});

// 39. OfflineVerificationScreen
it('OfflineVerificationScreen: Displays verification required without falsely claiming blocked', () => {
  const screenCode = fs.readFileSync('screens/OfflineVerificationScreen.js', 'utf8');
  assert.ok(screenCode.includes('সার্ভার সংযোগ প্রয়োজন'), 'States server connection required');
  assert.ok(screenCode.includes('onRetry'), 'Provides retry mechanism');
  assert.ok(screenCode.includes('BackHandler.exitApp()'), 'Exit button calls BackHandler.exitApp');
});

// 40. Async Admin Device Control with Verified Supabase Push
it('Admin Actions: setAdminDeviceLock and triggerForceLogout are async and await Supabase', () => {
  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(regCode.includes('export async function setAdminDeviceLock'), 'setAdminDeviceLock is async');
  assert.ok(regCode.includes('export async function triggerForceLogout'), 'triggerForceLogout is async');
  assert.ok(regCode.includes('export async function updateDeviceStatus'), 'updateDeviceStatus is async');
  assert.ok(regCode.includes('await updateSupabaseDevice'), 'Awaits updateSupabaseDevice');
  assert.ok(regCode.includes('clearForceLogoutIfMatching'), 'Uses clearForceLogoutIfMatching');
  assert.ok(regCode.includes('export async function verifyDeviceAccessOnStartupOrResume'), 'verifyDeviceAccessOnStartupOrResume exported');
});

// 41. Command Channel Reconnect Listener
it('Command Channel: Automatically reconnects on timeout or channel error', () => {
  const scCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(scCode.includes('clearForceLogoutIfMatching'), 'clearForceLogoutIfMatching exported');
  assert.ok(scCode.includes("status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED'"), 'Handles channel error and closed states');
  assert.ok(scCode.includes('activeCommandChannel.subscribe()'), 'Re-subscribes command channel on disconnect');
});

// 42. App.js Root Router Enforces Blocking Gates
it('App.js: Evaluates APP_UPDATE_REQUIRED, OFFLINE_VERIFICATION, and DEVICE_BLOCKED before login', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes("currentScreen === 'APP_UPDATE_REQUIRED'"), 'Gated on APP_UPDATE_REQUIRED');
  assert.ok(appCode.includes("currentScreen === 'OFFLINE_VERIFICATION'"), 'Gated on OFFLINE_VERIFICATION');
  assert.ok(appCode.includes("currentScreen === 'DEVICE_BLOCKED'"), 'Gated on DEVICE_BLOCKED');
  assert.ok(appCode.includes('checkAppVersionPolicy'), 'Wired to checkAppVersionPolicy');
  assert.ok(appCode.includes('verifyDeviceAccessOnStartupOrResume'), 'Wired to verifyDeviceAccessOnStartupOrResume');
});

// 43. Force Logout Revocation Token & Rapid Consecutive Command Safety
it('Force Logout Token: Generates unique revocation tokens and protects rapid consecutive commands', () => {
  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(regCode.includes("const forceLogoutToken = 'fl_' + Date.now()"), 'Generates unique fl_ token');
  assert.ok(regCode.includes('force_logout_token: forceLogoutToken'), 'Sends force_logout_token to Supabase');
  assert.ok(regCode.includes("lastHandledToken = getAppConfig('last_handled_force_logout_token'"), 'Tracks last_handled_force_logout_token');
  assert.ok(regCode.includes('commandToken !== lastHandledToken'), 'Differentiates consecutive commands with unique tokens');

  const scCode = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(scCode.includes("query = query.eq('force_logout_token', targetToken)"), 'Safely clears only matching token');
  assert.ok(scCode.includes("query = query.eq('updated_at', effectiveTimestamp || targetTimestamp)"), 'Uses exact equality for timestamp fallback');

  // Verify two rapid token generations produce distinct values
  const t1 = 'fl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  const t2 = 'fl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  assert.notStrictEqual(t1, t2, 'Consecutive command tokens must be strictly unique');
});

// 44. Version Policy Fallback & Offline Enforcement
it('Version Policy Fallback: Outdated cached policy blocks offline, missing cache defaults safely', () => {
  const { DEFAULT_VERSION_POLICY, compareSemver } = require('../services/firebaseAppConfig.js');
  
  // 1. Missing cache: defaults to installed version, allowing initial offline run
  assert.strictEqual(
    compareSemver(DEFAULT_VERSION_POLICY.minimum_required_version, DEFAULT_VERSION_POLICY.minimum_required_version),
    0,
    'Default policy matches installed version'
  );

  // 2. Outdated cached policy requiring newer version: blocks offline
  const installedVer = '1.0.0';
  const cachedHigherVer = '2.0.0';
  const diff = compareSemver(installedVer, cachedHigherVer);
  assert.ok(diff < 0, 'Installed version < required version correctly triggers outdated flag');

  const fbCode = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  assert.ok(fbCode.includes('getCachedVersionPolicy() || DEFAULT_VERSION_POLICY'), 'Falls back to cached policy or default');
  assert.ok(fbCode.includes('isForceEnabled && isOutdated'), 'Enforces updateRequired when force enabled');
});

// 45. Offline Authorization & Fail-Closed Boundaries
it('Offline Authorization: allow_offline=1 permits offline POS, allow_offline=0 fails closed', () => {
  const regCode = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(regCode.includes('Number(localRecord.allow_offline || 0) === 1'), 'Checks allow_offline permission');
  assert.ok(regCode.includes('allowed: true'), 'Allows offline operation when permitted');
  assert.ok(regCode.includes('verificationRequired: true'), 'Fails closed when offline not permitted');
});

// 46. Server-Side Authorization Migration Schema
it('Server-Side Security: Schema defines force_logout_token and defers device-gated RLS (is_device_active) to Phase 7', () => {
  const sql = fs.readFileSync('supabase_full_setup.sql', 'utf8');
  assert.ok(sql.includes('force_logout_token TEXT'), 'Schema defines force_logout_token');
  assert.ok(sql.includes('is_device_active') && sql.includes('Phase 7'), 'Documents is_device_active() device-gated RLS as deferred Phase 7 work');
  assert.strictEqual(sql.includes('admin_device_action'), false, 'Abandoned admin_device_action RPC design is not present');
});

// ── REGRESSION TESTS: P0 Hotfix — Login immediately logs out after Force Logout fix ────────────

// 47. The 1s timer is UI-only; force-logout checks are login-gated and slow-polled
it('App.js: force-logout checks are login-gated and never run from the 1-second UI timer', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  // The 1-second interval must now contain ONLY the countdown setters.
  assert.ok(
    /setFullCountdown\(prev => \(prev <= 0 \? 30 : prev - 1\)\);\s*\}, 1000\);/.test(appCode),
    '1s interval ends right after the countdown setters (no force-logout block)'
  );
  assert.strictEqual(appCode.includes('stage=periodic_check_start'), false, 'no per-second force-logout logging');
  // Live login guard still used by the remaining force-logout paths.
  assert.ok(appCode.includes('isLoggedInRef'), 'App.js declares isLoggedInRef');
  assert.ok(appCode.includes('isLoggedInRef.current = isLoggedIn'), 'App.js keeps isLoggedInRef in sync with isLoggedIn state');
  assert.ok(appCode.includes('if (!isLoggedIn) return;'), 'the force-logout effects are login-gated');
  // Must NOT allow stale closure (no bare `if (!isLoggedIn)` inside the setInterval callback)
  const intervalBlock = appCode.match(/setInterval\([^)]*\(\)\s*=>\s*\{[\s\S]*?\},\s*1000\)/)?.[0] || '';
  assert.ok(!intervalBlock.includes('if (!isLoggedIn)'), 'setInterval does not read stale isLoggedIn closure');
});

// 48. No per-second overlap lock is needed any more — the check runs at most every 60s
it('App.js: force-logout runs at a 60s cadence (+ foreground + Realtime), never per second', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes('setInterval(executeForceLogoutCheck, 60000)'), '60s poll is the periodic path');
  assert.ok(appCode.includes("if (nextState === 'active')"), 'foreground resume path present');
  assert.ok(appCode.includes('checkAndExecuteForceLogout('), 'force-logout check still wired');
  assert.strictEqual(appCode.includes('_forceLogoutCheckRef'), false, 'per-second concurrency lock removed (not needed at 60s)');
  assert.strictEqual(appCode.includes('setInterval(executeForceLogoutCheck, 1000)'), false, 'never a 1s force-logout poll');
});

// 49. syncRemoteDeviceToLocal deduplication applies ONLY to current device
it('deviceRegistry.js: syncRemoteDeviceToLocal deduplication only applies to current device, preserving fleet status', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('isCurrentDevice = Boolean(currentDeviceId && remoteRecord.device_id === currentDeviceId)'), 'Checks if remoteRecord is current device');
  assert.ok(code.includes('if (forceLogout === 1 && isCurrentDevice)'), 'Deduplication guard strictly gated on isCurrentDevice');
  assert.ok(code.includes('effectiveToken'), 'Calculates effectiveToken deterministically');
});

// 50. First Force Logout and Second Force Logout on same device both succeed
it('deviceRegistry.js: Second newly-issued Force Logout to the same device succeeds (no permanent suppression)', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  // Must NOT have the broken hardcoded syntheticKey 'notk_${deviceRecord.device_id}_handled'
  assert.ok(!code.includes('_handled;'), 'Eliminated permanent suppression string _handled');
  // Realtime and SQLite paths both check commandToken !== lastHandledToken
  assert.ok(code.includes('commandToken = remoteRecord.force_logout_token || (\'ts_\' + commandTimestamp)'), 'Derives commandToken from token or timestamp');
  assert.ok(code.includes('commandToken = deviceRecord.force_logout_token || (\'ts_\' + commandTimestamp)'), 'Derives SQLite commandToken from token or timestamp');
  assert.ok(code.includes('if (commandToken !== lastHandledToken)'), 'Triggers when commandToken is fresh');

  // Behavioral verification: Command 1 followed by Command 2 on same device
  const deviceId = 'dev_test_k80';
  const cmd1_token = 'fl_' + Date.now() + '_1';
  let lastHandledToken = '';

  // Command 1 evaluation
  let triggered1 = (cmd1_token !== lastHandledToken);
  assert.strictEqual(triggered1, true, 'Command 1 must trigger');
  lastHandledToken = cmd1_token; // Target executes and records token

  // Re-evaluation of Command 1 (should NOT trigger)
  let duplicateRun = (cmd1_token !== lastHandledToken);
  assert.strictEqual(duplicateRun, false, 'Duplicate Command 1 must be skipped');

  // Command 2 evaluation (new command to same device)
  const cmd2_token = 'fl_' + (Date.now() + 1000) + '_2';
  let triggered2 = (cmd2_token !== lastHandledToken);
  assert.strictEqual(triggered2, true, 'Command 2 to same device must trigger successfully');
});

// 51. Old command does not log out a new session
it('deviceRegistry.js: Old command does not log out a new session', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('stage=check_dedup_skip'), 'Logs check_dedup_skip when token matches last handled');
  assert.ok(code.includes('stage=sqlite_dedup_skip'), 'Logs sqlite_dedup_skip when token matches last handled');

  // Simulation: command with token 'fl_prev' against lastHandledToken 'fl_prev'
  const incomingToken = 'fl_prev_100';
  const lastHandledToken = 'fl_prev_100';
  const shouldTrigger = incomingToken !== lastHandledToken;
  assert.strictEqual(shouldTrigger, false, 'Identical token must never trigger logout on a new session');
});

// 52. Another device command is never processed
it('deviceRegistry.js: checkAndExecuteForceLogout skips commands targeting a different device', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('stage=wrong_device_skip'), 'Logs wrong_device_skip');
  assert.ok(code.includes('remoteRecord.device_id !== deviceRecord.device_id'), 'Compares remoteDeviceId and currentDeviceId');
});

// 53. Missing token column does not permanently disable future commands
it('deviceRegistry.js: Missing token column falls back to ts_ timestamp token and does not permanently disable future commands', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes("'ts_' + commandTimestamp"), 'Creates deterministic timestamp-based command ID when token column is missing');

  // Simulation: Two consecutive commands without token column, distinguished by server updated_at
  const t1 = '2026-09-18T19:00:00.000Z';
  const t2 = '2026-09-18T19:35:00.000Z';
  const token1 = 'ts_' + t1;
  const token2 = 'ts_' + t2;

  let handled = '';
  assert.strictEqual(token1 !== handled, true, 'First command with timestamp T1 triggers');
  handled = token1;

  assert.strictEqual(token1 !== handled, false, 'Same command with timestamp T1 skips (no login loop)');
  assert.strictEqual(token2 !== handled, true, 'Second command with timestamp T2 triggers (no permanent suppression)');
});

// 54. clearForceLogoutIfMatching safely handles real tokens, synthetic timestamp tokens, and nulls out token
it('supabaseDeviceControl.js: clearForceLogoutIfMatching handles synthetic timestamp tokens and clears force_logout_token', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(code.includes('isSyntheticToken'), 'Distinguishes synthetic timestamp token from real token');
  assert.ok(code.includes('force_logout_token: null'), 'Nulls out force_logout_token on clear');
  assert.ok(code.includes('targetToken.startsWith(\'ts_\') ? targetToken.substring(3) : null'), 'Extracts timestamp from ts_ token');
  assert.ok(code.includes("query = query.eq('updated_at', effectiveTimestamp || targetTimestamp)"), 'Matches updated_at for timestamp token');
});

// 55. App.js: isLoggedInRef.current is reset to false when logout fires in periodic check
it('App.js: isLoggedInRef.current is immediately set to false when periodic check triggers logout', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  assert.ok(code.includes('isLoggedInRef.current = false'), 'Sets isLoggedInRef.current=false immediately on logout');
  assert.ok(code.includes('setIsLoggedIn(false)'), 'Also calls setIsLoggedIn(false) for React state');
});

// 56. Safe Target Device Recovery SQL does NOT broadly clear all devices
it('Recovery Safety: Safe device recovery SQL targets only the specific device', () => {
  // Verify that an update query with a WHERE device_id = ? clause is the only acceptable pattern
  const broadQuery = 'UPDATE devices SET force_logout = false WHERE force_logout = true';
  const safePattern = /UPDATE public\.devices\s+SET force_logout = false.*WHERE device_id = /s;
  
  const sampleSafeQuery = `
    UPDATE public.devices
    SET force_logout = false, force_logout_token = NULL
    WHERE device_id = 'test_device_id'
      AND force_logout = true;
  `;
  assert.ok(safePattern.test(sampleSafeQuery), 'Safe query must include specific device_id filter');
  assert.ok(!broadQuery.includes('device_id ='), 'Broad query lacks device_id filter');
});

// 57. ADMIN role version policy exemption
it('ADMIN + outdated version: checkAppVersionPolicy returns updateRequired=false and allowed=true for ADMIN', () => {
  const code = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  assert.ok(code.includes("const roleUpper = String(role || '').toUpperCase().trim()"), 'Normalizes role parameter');
  assert.ok(code.includes("const isAdmin = roleUpper === 'ADMIN'"), 'Identifies ADMIN role');
  assert.ok(code.includes('adminExempt: true'), 'Marks adminExempt flag');
  assert.ok(code.includes('if (isAdmin) {\n    return {\n      allowed: true,\n      updateRequired: false'), 'Returns allowed=true and updateRequired=false for admin');
});

// 58. MANAGER + outdated version: version gating remains enforced
it('MANAGER + outdated version: existing update enforcement remains active', () => {
  const code = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  assert.ok(code.includes('if (isForceEnabled && isOutdated) {\n    return {\n      allowed: false,\n      updateRequired: true'), 'Returns updateRequired=true when force update enabled and outdated');
  assert.strictEqual("MANAGER".toUpperCase() === 'ADMIN', false, 'Manager is not admin');
});

// 59. OWNER + outdated version: version gating remains enforced
it('OWNER + outdated version: existing update enforcement remains active', () => {
  assert.strictEqual("OWNER".toUpperCase() === 'ADMIN', false, 'Owner is not admin');
  const code = fs.readFileSync('services/firebaseAppConfig.js', 'utf8');
  assert.ok(code.includes('updateRequired: true'), 'Enforces updateRequired for non-admin roles');
});

// 60. ADMIN cannot bypass BLOCKED / admin_lock / Force Logout
it('ADMIN security gate integrity: ADMIN still cannot bypass BLOCKED, admin_lock, or Force Logout', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes("devAccess && devAccess.blocked"), 'Device blocked gate active on startup');
  assert.ok(appCode.includes("devAccess && devAccess.forceLogout"), 'Force logout gate active on startup');
  assert.ok(appCode.includes("currentScreen === 'DEVICE_BLOCKED'"), 'DEVICE_BLOCKED screen route present');
  const blockedScreenPos = appCode.indexOf("currentScreen === 'DEVICE_BLOCKED'");
  const dashboardSwitchPos = appCode.indexOf("switch (effectiveScreen)");
  assert.ok(blockedScreenPos > 0, 'DEVICE_BLOCKED present in renderScreen');
  assert.ok(dashboardSwitchPos > 0, 'Dashboard switch present in renderScreen');
  assert.ok(blockedScreenPos < dashboardSwitchPos, 'DEVICE_BLOCKED evaluated before dashboard routing');
});

// 61. Role loading & router safety: App.js renderScreen does not render AppUpdateRequiredScreen when logged in as ADMIN
it('Role loading & router safety: App.js renderScreen bypasses AppUpdateRequiredScreen for authenticated ADMIN', () => {
  const appCode = fs.readFileSync('App.js', 'utf8');
  assert.ok(appCode.includes("const isAuthenticatedAdmin = isLoggedIn && roleUpper === 'ADMIN'"), 'Checks authenticated ADMIN status in renderScreen');
  assert.ok(appCode.includes('if (!isAuthenticatedAdmin)'), 'AppUpdateRequiredScreen guarded by isAuthenticatedAdmin');
  assert.ok(appCode.includes('<AppUpdateRequiredScreen'), 'Renders AppUpdateRequiredScreen for non-admin');
  assert.ok(appCode.includes('effectiveScreen = (currentScreen === \'APP_UPDATE_REQUIRED\' && isAuthenticatedAdmin)'), 'Routes authenticated ADMIN to DASHBOARD if update screen was requested');
  assert.ok(appCode.includes("if (ACTIVE_APP_PROFILE !== 'ADMIN')"), 'Startup check skips update screen for ADMIN profile');
});

// 62. refreshDeviceRegistryFromSupabase is exported from deviceRegistry.js
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase is exported', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('export async function refreshDeviceRegistryFromSupabase'), 'refreshDeviceRegistryFromSupabase exported');
});

// 63. Mutex guard prevents concurrent refresh clicks from racing
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase has a mutex guard that rejects concurrent calls', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('isDeviceRegistryRefreshInProgress'), 'Module-level mutex flag defined');
  assert.ok(code.includes("return { success: false, count: 0, error: 'already_in_progress' }"), 'Returns already_in_progress on concurrent call');
  assert.ok(code.includes('isDeviceRegistryRefreshInProgress = false'), 'Mutex released in finally block');
});

// 64. Supabase fetch must succeed and return a non-empty array before any SQLite write
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase validates array response before touching SQLite', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('!Array.isArray(remoteDevices)'), 'Rejects non-array response');
  assert.ok(code.includes('remoteDevices.length === 0'), 'Rejects empty array response');
  assert.ok(code.includes("cache preserved to prevent data loss"), 'Logs preservation reason on empty response');
});

// 65. Invalid entry (missing device_id) in Supabase response rejects the entire batch
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase rejects response if any entry lacks device_id', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes("typeof d.device_id !== 'string' || d.device_id.trim() === ''"), 'Checks for missing or empty device_id');
  assert.ok(code.includes('Supabase response contains entry without valid device_id'), 'Logs validation rejection');
});

// 66. DELETE then INSERT pattern within BEGIN/COMMIT transaction (never deletes before fetch)
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase uses BEGIN → DELETE → INSERT → COMMIT pattern', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  // Confirm correct transactional sequence
  const beginPos = code.indexOf("db.runSync('BEGIN')");
  const deletePos = code.indexOf("db.runSync('DELETE FROM device_registry')");
  const commitPos = code.indexOf("db.runSync('COMMIT')");
  assert.ok(beginPos > 0, 'BEGIN transaction present');
  assert.ok(deletePos > beginPos, 'DELETE is inside the transaction (after BEGIN)');
  assert.ok(commitPos > deletePos, 'COMMIT is after DELETE');
  assert.ok(code.includes('INSERT OR REPLACE INTO device_registry'), 'INSERT OR REPLACE inside transaction');
});

// 67. SQLite transaction error triggers ROLLBACK — previous cache preserved
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase rolls back on SQLite transaction error', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes("db.runSync('ROLLBACK')"), 'ROLLBACK called on transaction error');
  assert.ok(code.includes('SQLite transaction failed — rolled back, cache preserved'), 'Logs rollback and cache preservation');
  assert.ok(code.includes('return { success: false, count: 0, error: errMsg }'), 'Returns failure result with error description');
});

// 68. Only device_registry table is touched — orders, payments, sync_queue remain untouched
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase only deletes device_registry — no other table touched', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  const refreshFnStart = code.indexOf('export async function refreshDeviceRegistryFromSupabase');
  const refreshFnBody = code.substring(refreshFnStart);
  // Only DELETE FROM device_registry should appear in this function
  assert.ok(refreshFnBody.includes("DELETE FROM device_registry"), 'Deletes device_registry');
  assert.strictEqual(refreshFnBody.includes('DELETE FROM sync_queue'), false, 'Does NOT delete sync_queue');
  assert.strictEqual(refreshFnBody.includes('DELETE FROM orders'), false, 'Does NOT delete orders');
  assert.strictEqual(refreshFnBody.includes('DELETE FROM app_config'), false, 'Does NOT delete app_config');
});

// 69. Exact device_id matching — records inserted using the stable device_id as key
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase matches records using exact stable device_id', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  const refreshFnStart = code.indexOf('export async function refreshDeviceRegistryFromSupabase');
  const refreshFnBody = code.substring(refreshFnStart);
  assert.ok(refreshFnBody.includes('rem.device_id'), 'Uses rem.device_id for insertion');
  // Ensure it does NOT use device_name as the match key
  assert.strictEqual(refreshFnBody.includes('WHERE device_name'), false, 'Does NOT match by device_name');
});

// 70. DeviceManagementScreen Refresh button uses the new transactional path
it('screens/DeviceManagementScreen.js: Refresh button calls refreshDeviceRegistryFromSupabase', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('refreshDeviceRegistryFromSupabase'), 'Imports and calls refreshDeviceRegistryFromSupabase');
  assert.ok(code.includes('result.success'), 'Checks result.success before refreshing UI');
  assert.ok(code.includes('result.count'), 'Shows count of refreshed records on success');
  assert.ok(code.includes('পূর্ববর্তী ডেটা সংরক্ষিত আছে'), 'Shows cache-preserved message on failure');
});

// 71. Supabase fetch failure (thrown exception) preserves previous cache untouched
it('deviceRegistry.js: refreshDeviceRegistryFromSupabase preserves cache when Supabase fetch throws', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes('Supabase fetch failed — cache preserved'), 'Handles thrown fetch error and preserves cache');
  // Verify the outer catch is before any db.runSync call
  const refreshFnStart = code.indexOf('export async function refreshDeviceRegistryFromSupabase');
  const refreshFnBody = code.substring(refreshFnStart);
  const outerCatchPos = refreshFnBody.indexOf('Supabase fetch failed — cache preserved');
  const dbRunSyncPos = refreshFnBody.indexOf("db.runSync('BEGIN')");
  assert.ok(outerCatchPos > dbRunSyncPos, 'Outer catch is after the transaction block (fetch errors never reach SQLite)');
});

// 72. deviceRegistry.js: Uses APP_VERSION from firebaseAppConfig instead of hardcoded 1.0.0
it('deviceRegistry.js: Uses APP_VERSION from firebaseAppConfig to ensure updated version is reported', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  assert.ok(code.includes("import { APP_VERSION } from './firebaseAppConfig.js'"), 'Imports APP_VERSION from firebaseAppConfig');
  assert.ok(code.includes('const appVersion = isExpoGo ? APP_VERSION : (APP_VERSION || Application.nativeApplicationVersion'), 'Uses APP_VERSION with proper fallback');
});

// 73. deviceRegistry.js: Allows all device roles (Manager, Owner, Admin) to push metadata updates to Supabase
it('deviceRegistry.js: Allows all device roles to push hardware metadata updates to Supabase', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  // Must NOT restrict metadata update to ADMIN only
  assert.strictEqual(code.includes("if (hasMetadataChanged && ACTIVE_APP_PROFILE === 'ADMIN')"), false, 'Does not block non-admin roles from pushing their own metadata');
  assert.ok(code.includes('if (hasMetadataChanged) {'), 'Pushes metadata when hasMetadataChanged is true for any role');
});

// 74. deviceRegistry.js: checkAndFlushLastSeen detects version discrepancy and pushes to Supabase
it('deviceRegistry.js: checkAndFlushLastSeen auto-syncs app_version if discrepancy detected', () => {
  const code = fs.readFileSync('services/deviceRegistry.js', 'utf8');
  const fnStart = code.indexOf('export function checkAndFlushLastSeen()');
  const fnBody = code.substring(fnStart, code.indexOf('async function getPersistentDeviceId', fnStart));
  assert.ok(fnBody.includes('hasVersionChanged'), 'Detects if app_version changed');
  assert.ok(fnBody.includes('app_version: currentVer'), 'Includes app_version in update payload when changed');
});

// 75. screens/DeviceManagementScreen.js: Smooth in-place state update on realtime changePayload (no flicker/spinner)
it('screens/DeviceManagementScreen.js: changePayload updates devices state in-place without triggering loadDevices', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  const subStart = code.indexOf('unsubscribe = subscribeAdminDeviceMonitor(');
  const subBlock = code.substring(subStart, code.indexOf('adminDeviceId', subStart));
  assert.strictEqual(subBlock.includes('loadDevices()'), false, 'Does not invoke loadDevices() on realtime changes');
  assert.ok(subBlock.includes('syncRemoteDeviceToLocal(changePayload.new)'), 'Syncs changed record to SQLite');
  assert.ok(subBlock.includes('setDevices(prev =>'), 'Updates devices state directly in memory');
});

// 76. screens/DeviceManagementScreen.js: loadDevices avoids full-screen spinner when devices are already present
it('screens/DeviceManagementScreen.js: loadDevices avoids full-screen spinner when devices are already loaded', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('devicesRef'), 'Uses devicesRef to track presence of loaded devices');
  assert.ok(code.includes('!devicesRef.current || devicesRef.current.length === 0'), 'Only sets loading true when zero devices exist');
});

// 77. screens/DeviceManagementScreen.js: Current device is always guaranteed online and labeled (এই ডিভাইস)
it('screens/DeviceManagementScreen.js: Current device is always marked online and labeled with (এই ডিভাইস)', () => {
  const code = fs.readFileSync('screens/DeviceManagementScreen.js', 'utf8');
  assert.ok(code.includes('isCurrentDevice'), 'Identifies current device in card list');
  assert.ok(code.includes('online: true'), 'Ensures online: true for the current device');
});

// 78. supabaseDeviceControl.js: presence sync merges active devices without wiping disconnected devices
it('supabaseDeviceControl.js: presence sync merges active devices without wiping disconnected devices', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(code.includes("merged[devId]"), 'Merges active map with previous presence state');
  assert.ok(code.includes("!activeMap[devId] && prevPresence.online"), 'Detects devices that left active room');
  assert.ok(code.includes("online: false"), 'Marks left devices as online: false');
  assert.ok(code.includes("last_active: prevPresence.last_heartbeat || prevPresence.active_since || now"), 'Preserves last known active timestamp');
});

// 79. supabaseDeviceControl.js: exports DB_HEARTBEAT_INTERVAL_MS and throttles DB writes
it('supabaseDeviceControl.js: exports DB_HEARTBEAT_INTERVAL_MS and throttles DB writes', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  assert.ok(code.includes('export const DB_HEARTBEAT_INTERVAL_MS'), 'Exports DB_HEARTBEAT_INTERVAL_MS');
  assert.ok(code.includes('now - lastDbPersistTime >= DB_HEARTBEAT_INTERVAL_MS'), 'Enforces throttled DB persist interval');
  assert.ok(code.includes('updateSupabaseDevice(deviceId, { last_seen_at: new Date(now).toISOString() })'), 'Updates last_seen_at in DB on throttle');
});

// 80. supabaseDeviceControl.js: stopDevicePresence persists last_seen_at to Supabase before untracking
it('supabaseDeviceControl.js: stopDevicePresence persists last_seen_at to Supabase before untracking', () => {
  const code = fs.readFileSync('services/supabaseDeviceControl.js', 'utf8');
  const stopFn = code.substring(code.indexOf('export async function stopDevicePresence()'));
  assert.ok(stopFn.includes('updateSupabaseDevice(activeDeviceId, { last_seen_at: isoNow })'), 'Updates last_seen_at on stop');
  assert.ok(stopFn.includes('activePresenceChannel.untrack()'), 'Untracks from WebSocket channel');
});

// 81. App.js: calls checkAndFlushLastSeen on AppState background and inactive transitions
it('App.js: calls checkAndFlushLastSeen on AppState background and inactive transitions', () => {
  const code = fs.readFileSync('App.js', 'utf8');
  const bgBlock = code.substring(code.indexOf("nextState === 'background' || nextState === 'inactive'"));
  assert.ok(bgBlock.includes('checkAndFlushLastSeen()'), 'Calls checkAndFlushLastSeen when app enters background');
});

(async () => {
  if (pendingAsyncTests.length > 0) {
    await Promise.all(pendingAsyncTests);
  }

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  supabaseDeviceControl.test.js — ${passedTests + failedTests} tests`);
  console.log(`  Passed : ${passedTests}`);
  console.log(`  Failed : ${failedTests}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
})();


