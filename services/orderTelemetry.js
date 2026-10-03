/**
 * Order Telemetry & Device Attribution Service
 * 
 * Embeds user identity (e.g. রহিম (ম্যানেজার)) and device telemetry (e.g. Manager Tablet (Galaxy Tab A))
 * inside each item's JSON payload in orders/tables/deliveries.
 * Syncs seamlessly across SQLite and Supabase without altering cloud database schemas.
 */

/**
 * Formats user role and display name into a standard label.
 * e.g. "রহিম (ম্যানেজার)", "মালিক", "কবীর (মালিক)", "অ্যাডমিন", "কাউন্টার"
 *
 * @param {string} userRole - 'manager', 'owner', 'admin', etc.
 * @param {string} userDisplayName - e.g. 'রহিম', 'মালিক', etc.
 * @returns {string} Formatted user role string
 */
export function formatUserRoleTag(userRole, userDisplayName) {
  const role = String(userRole || '').toLowerCase().trim();
  const name = String(userDisplayName || '').trim();

  let roleLabel = '';
  if (role === 'manager') roleLabel = 'ম্যানেজার';
  else if (role === 'owner') roleLabel = 'মালিক';
  else if (role === 'admin') roleLabel = 'অ্যাডমিন';
  else roleLabel = 'কাউন্টার';

  if (!name) {
    return roleLabel;
  }

  // If name already contains parentheses with role, keep it as is
  if (name.includes('(') && name.includes(')')) {
    return name;
  }

  // If name is already just the role label
  if (name.toLowerCase() === role || name === roleLabel) {
    return roleLabel;
  }

  return `${name} (${roleLabel})`;
}

/**
 * Resolves current device telemetry name from device registry or hardware.
 * e.g. "Manager Tablet (Galaxy Tab A)", "Counter Phone (Samsung A12)", "Counter Tablet"
 *
 * @returns {string} Formatted device name
 */
export function getCurrentDeviceTelemetryName() {
  try {
    const devReg = require('./deviceRegistry');
    const getRec = devReg.getCurrentDeviceRecord || devReg.default?.getCurrentDeviceRecord;
    if (typeof getRec === 'function') {
      const rec = getRec();
      if (rec) {
        const name = (rec.device_name || '').trim();
        const model = (rec.model || '').trim();
        const brand = (rec.brand || rec.manufacturer || '').trim();

        const isGenericName = !name ||
          name.toLowerCase() === 'android device' ||
          name.toLowerCase() === 'pos terminal' ||
          name.toLowerCase() === 'device';

        if (!isGenericName && model && !name.toLowerCase().includes(model.toLowerCase())) {
          return `${name} (${model})`;
        }
        if (!isGenericName) return name;
        if (brand && model && !model.toLowerCase().includes(brand.toLowerCase())) {
          return `${brand} ${model}`;
        }
        if (model && model.toLowerCase() !== 'android') return model;
      }
    }
  } catch (_) {}

  try {
    const Device = require('expo-device');
    const dName = (Device.deviceName || '').trim();
    const dModel = (Device.modelName || '').trim();
    const dBrand = (Device.brand || Device.manufacturer || '').trim();

    const isGenericName = !dName ||
      dName.toLowerCase() === 'android device' ||
      dName.toLowerCase() === 'pos terminal';

    if (!isGenericName && dModel && !dName.toLowerCase().includes(dModel.toLowerCase())) {
      return `${dName} (${dModel})`;
    }
    if (!isGenericName) return dName;
    if (dBrand && dModel && !dModel.toLowerCase().includes(dBrand.toLowerCase())) {
      return `${dBrand} ${dModel}`;
    }
    if (dModel && dModel.toLowerCase() !== 'android') return dModel;
    if (dBrand && dBrand.toLowerCase() !== 'android') return `${dBrand} Device`;
  } catch (_) {}

  return 'কাউন্টার ডিভাইস';
}

/**
 * Formats current local time (e.g. "01:35 AM")
 *
 * @returns {string}
 */
export function getFormattedLocalTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Stamps an order item with user, role, device, and timestamp telemetry.
 *
 * @param {object} item - Item object ({ name, price, qty, ... })
 * @param {string} userRole - User role ('manager', 'owner', 'admin')
 * @param {string} userDisplayName - User name
 * @param {string} [customTime] - Optional override time
 * @returns {object} Stamped item
 */
export function stampOrderItem(item, userRole, userDisplayName, customTime) {
  if (!item || typeof item !== 'object') return item;

  const nowTime = customTime || getFormattedLocalTime();
  const taker = formatUserRoleTag(userRole, userDisplayName);
  const device = getCurrentDeviceTelemetryName();

  return {
    ...item,
    time: item.time || nowTime,
    addedBy: item.addedBy || taker,
    deviceName: item.deviceName || device,
    lastEditedBy: taker,
    lastEditedTime: nowTime,
    lastEditedDevice: device
  };
}

/**
 * Extracts order-level telemetry summary for the Admin Monitor Modal.
 * Finds the latest item edit or falls back to table creation data.
 *
 * @param {object} orderOrTable - Table or delivery object
 * @returns {{ latestEditor: string, latestDevice: string, latestEditTime: string }}
 */
export function getOrderTelemetrySummary(orderOrTable) {
  if (!orderOrTable) {
    return {
      latestEditor: 'ম্যানেজার / ক্যাশ কাউন্টার',
      latestDevice: 'কাউন্টার ডিভাইস',
      latestEditTime: 'চলমান'
    };
  }

  let items = [];
  if (Array.isArray(orderOrTable.items)) {
    items = orderOrTable.items;
  } else if (typeof orderOrTable.items === 'string') {
    try {
      items = JSON.parse(orderOrTable.items || '[]');
    } catch (_) {
      items = [];
    }
  }

  // Find the last item that was modified or added
  const lastItemWithEdit = [...items].reverse().find(
    i => i && (i.lastEditedBy || i.addedBy || i.lastEditedDevice || i.deviceName)
  ) || items[items.length - 1] || null;

  const latestEditor = lastItemWithEdit?.lastEditedBy ||
    lastItemWithEdit?.addedBy ||
    orderOrTable.orderedBy ||
    orderOrTable.created_by ||
    'ম্যানেজার / ক্যাশ কাউন্টার';

  const latestDevice = lastItemWithEdit?.lastEditedDevice ||
    lastItemWithEdit?.deviceName ||
    lastItemWithEdit?.device ||
    orderOrTable.deviceName ||
    orderOrTable.device ||
    'কাউন্টার ডিভাইস';

  const latestEditTime = lastItemWithEdit?.lastEditedTime ||
    lastItemWithEdit?.time ||
    'চলমান';

  return {
    latestEditor,
    latestDevice,
    latestEditTime
  };
}

// CommonJS support for test runner
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatUserRoleTag,
    getCurrentDeviceTelemetryName,
    getFormattedLocalTime,
    stampOrderItem,
    getOrderTelemetrySummary
  };
}
