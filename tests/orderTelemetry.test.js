/**
 * Order Telemetry & Device Attribution Test Suite
 * Run with: node tests/orderTelemetry.test.js
 */

'use strict';
const assert = require('assert');

console.log('======================================================');
console.log('   ORDER TELEMETRY & DEVICE ATTRIBUTION TESTS        ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

// Mock expo-device before importing
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === 'expo-device') {
    return {
      deviceName: 'Manager Phone',
      modelName: 'Samsung A12',
      manufacturer: 'Samsung',
      brand: 'Samsung'
    };
  }
  return originalRequire.apply(this, arguments);
};

const {
  formatUserRoleTag,
  getCurrentDeviceTelemetryName,
  getFormattedLocalTime,
  stampOrderItem,
  getOrderTelemetrySummary
} = require('../services/orderTelemetry');

// 1. User & Role tag formatting
it('formatUserRoleTag formats manager with display name as Rahim (ম্যানেজার)', () => {
  const result = formatUserRoleTag('manager', 'রহিম');
  assert.strictEqual(result, 'রহিম (ম্যানেজার)');
});

it('formatUserRoleTag formats manager without display name as ম্যানেজার', () => {
  const result = formatUserRoleTag('manager', '');
  assert.strictEqual(result, 'ম্যানেজার');
});

it('formatUserRoleTag formats owner correctly', () => {
  assert.strictEqual(formatUserRoleTag('owner', 'মালিক'), 'মালিক');
  assert.strictEqual(formatUserRoleTag('owner', 'কবীর'), 'কবীর (মালিক)');
  assert.strictEqual(formatUserRoleTag('owner', ''), 'মালিক');
});

it('formatUserRoleTag formats admin correctly', () => {
  assert.strictEqual(formatUserRoleTag('admin', 'শাহেদ'), 'শাহেদ (অ্যাডমিন)');
  assert.strictEqual(formatUserRoleTag('admin', ''), 'অ্যাডমিন');
});

it('formatUserRoleTag handles already formatted name without duplicating', () => {
  assert.strictEqual(formatUserRoleTag('manager', 'রহিম (ম্যানেজার)'), 'রহিম (ম্যানেজার)');
});

it('formatUserRoleTag falls back to কাউন্টার for unknown', () => {
  assert.strictEqual(formatUserRoleTag('', ''), 'কাউন্টার');
});

// 2. Device telemetry name resolution
it('getCurrentDeviceTelemetryName returns formatted device name and model', () => {
  const name = getCurrentDeviceTelemetryName();
  assert.ok(name.includes('Samsung A12') || name.includes('Manager Phone') || name === 'কাউন্টার ডিভাইস');
});

// 3. Stamping order items
it('stampOrderItem attaches time, user tag, and device telemetry to item', () => {
  const rawItem = { name: 'চিকেন বার্গার', price: 180, qty: 2 };
  const stamped = stampOrderItem(rawItem, 'manager', 'রহিম', '01:35 AM');

  assert.strictEqual(stamped.name, 'চিকেন বার্গার');
  assert.strictEqual(stamped.price, 180);
  assert.strictEqual(stamped.qty, 2);
  assert.strictEqual(stamped.time, '01:35 AM');
  assert.strictEqual(stamped.addedBy, 'রহিম (ম্যানেজার)');
  assert.ok(stamped.deviceName, 'deviceName must be attached');
  assert.strictEqual(stamped.lastEditedBy, 'রহিম (ম্যানেজার)');
  assert.strictEqual(stamped.lastEditedTime, '01:35 AM');
  assert.strictEqual(stamped.lastEditedDevice, stamped.deviceName);
});

// 4. Order telemetry summary extraction
it('getOrderTelemetrySummary extracts latest editor, device, and edit time from items', () => {
  const table = {
    id: 'table_1',
    status: 'BUSY',
    items: [
      {
        name: 'বার্গার',
        price: 150,
        qty: 1,
        time: '01:20 AM',
        addedBy: 'রহিম (ম্যানেজার)',
        deviceName: 'Manager Tablet (Galaxy Tab A)',
        lastEditedBy: 'রহিম (ম্যানেজার)',
        lastEditedTime: '01:20 AM',
        lastEditedDevice: 'Manager Tablet (Galaxy Tab A)'
      },
      {
        name: 'কোল্ড কফি',
        price: 80,
        qty: 2,
        time: '01:35 AM',
        addedBy: 'মালিক',
        deviceName: 'Owner Phone (Pixel 7)',
        lastEditedBy: 'মালিক',
        lastEditedTime: '01:35 AM',
        lastEditedDevice: 'Owner Phone (Pixel 7)'
      }
    ]
  };

  const summary = getOrderTelemetrySummary(table);
  assert.strictEqual(summary.latestEditor, 'মালিক');
  assert.strictEqual(summary.latestDevice, 'Owner Phone (Pixel 7)');
  assert.strictEqual(summary.latestEditTime, '01:35 AM');
});

it('getOrderTelemetrySummary works when items is a JSON string', () => {
  const table = {
    id: 'D-12345',
    status: 'BUSY',
    items: JSON.stringify([
      {
        name: 'পিজ্জা',
        price: 350,
        qty: 1,
        time: '01:45 AM',
        addedBy: 'সাকিব (ম্যানেজার)',
        deviceName: 'Counter Tablet',
        lastEditedBy: 'সাকিব (ম্যানেজার)',
        lastEditedTime: '01:45 AM',
        lastEditedDevice: 'Counter Tablet'
      }
    ])
  };

  const summary = getOrderTelemetrySummary(table);
  assert.strictEqual(summary.latestEditor, 'সাকিব (ম্যানেজার)');
  assert.strictEqual(summary.latestDevice, 'Counter Tablet');
  assert.strictEqual(summary.latestEditTime, '01:45 AM');
});

it('getOrderTelemetrySummary falls back gracefully for empty items', () => {
  const table = {
    id: 'table_2',
    status: 'FREE',
    items: []
  };

  const summary = getOrderTelemetrySummary(table);
  assert.strictEqual(summary.latestEditor, 'ম্যানেজার / ক্যাশ কাউন্টার');
  assert.strictEqual(summary.latestDevice, 'কাউন্টার ডিভাইস');
  assert.strictEqual(summary.latestEditTime, 'চলমান');
});

// 5. Codebase integration checks
const fs = require('fs');
const adminSrc = fs.readFileSync('screens/AdminDB.js', 'utf8');
const appSrc = fs.readFileSync('App.js', 'utf8');
const addItemSrc = fs.readFileSync('screens/AddItemScreen.js', 'utf8');
const tableDetailSrc = fs.readFileSync('screens/TableDetailScreen.js', 'utf8');

it('AdminDB.js renders telemetry header summary (অর্ডার / এডিট করেছেন, ডিভাইস, সর্বশেষ এডিট)', () => {
  assert.ok(adminSrc.includes('getOrderTelemetrySummary'), 'AdminDB imports getOrderTelemetrySummary');
  assert.ok(adminSrc.includes('👤 অর্ডার / এডিট করেছেন'), 'Header summary shows Edited By label');
  assert.ok(adminSrc.includes('📱 ডিভাইস'), 'Header summary shows Device label');
  assert.ok(adminSrc.includes('🕒 সর্বশেষ এডিট'), 'Header summary shows Last Edit Time label');
  assert.ok(adminSrc.includes('telemetry.latestEditor'), 'Displays latest editor');
  assert.ok(adminSrc.includes('telemetry.latestDevice'), 'Displays latest device');
  assert.ok(adminSrc.includes('telemetry.latestEditTime'), 'Displays latest edit time');
});

it('AdminDB.js renders device telemetry badge for each item in the monitoring modal', () => {
  assert.ok(adminSrc.includes('📱 {itemDevice}'), 'Renders device pill for each item');
  assert.ok(adminSrc.includes('item.lastEditedDevice'), 'Resolves item last edited device');
  assert.ok(adminSrc.includes('item.lastEditedBy'), 'Resolves item last edited user');
});

it('App.js stamps items with telemetry in handleUpdateTableItems and passes props to TableDetailScreen', () => {
  assert.ok(appSrc.includes("require('./services/orderTelemetry')"), 'App.js requires orderTelemetry');
  assert.ok(appSrc.includes('stampedItems'), 'App.js stamps items with telemetry');
  assert.ok(appSrc.includes('userRole={userRole}'), 'passes userRole to TableDetailScreen');
  assert.ok(appSrc.includes('userDisplayName={userDisplayName}'), 'passes userDisplayName to TableDetailScreen');
});

it('AddItemScreen.js stamps items with telemetry on add and quantity change', () => {
  assert.ok(addItemSrc.includes("from '../services/orderTelemetry'"), 'AddItemScreen imports orderTelemetry');
  assert.ok(addItemSrc.includes('lastEditedDevice: device'), 'stamps lastEditedDevice');
  assert.ok(addItemSrc.includes('lastEditedBy: taker'), 'stamps lastEditedBy');
  assert.ok(addItemSrc.includes('deviceName: device'), 'stamps deviceName');
});

it('TableDetailScreen.js stamps items with telemetry on quantity change and quick water', () => {
  assert.ok(tableDetailSrc.includes("from '../services/orderTelemetry'"), 'TableDetailScreen imports orderTelemetry');
  assert.ok(tableDetailSrc.includes('lastEditedDevice: device'), 'stamps lastEditedDevice on qty change');
  assert.ok(tableDetailSrc.includes('lastEditedBy: taker'), 'stamps lastEditedBy on qty change');
  assert.ok(tableDetailSrc.includes('deviceName: device'), 'stamps deviceName on water add');
});


// Run all test cases
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✅  ${t.desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${t.desc}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

console.log('\n------------------------------------------------------');
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
