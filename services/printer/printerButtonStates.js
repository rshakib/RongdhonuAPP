/**
 * services/printer/printerButtonStates.js
 *
 * Pure logic for computing printer button enabled/disabled states and
 * Bangla user feedback messages.
 */

import { STATUS, MESSAGES } from './printerManager.js';

/**
 * Determine enabled/disabled states for all printer action buttons.
 *
 * @param {object} params
 * @param {object} params.status - Current status snapshot from getStatus()
 * @param {string|boolean} [params.busy=''] - Current busy action label or boolean
 * @param {boolean} [params.scanning=false] - Whether device discovery scan is in progress
 * @returns {object} { canConnect, canReconnect, canDisconnect, canTestPrint, canForget }
 */
export function computeButtonStates({ status = {}, busy = false, scanning = false } = {}) {
  const isBusy = Boolean(busy) || Boolean(status.connecting);
  const isScanning = Boolean(scanning);
  const isBlocked = isBusy || isScanning;

  const code = status.status || STATUS.NOT_CONFIGURED;
  const isUnsupported = code === STATUS.PLATFORM_UNSUPPORTED;
  const isConnected = code === STATUS.CONNECTED_READY || code === STATUS.FOUND_UNVERIFIED || Boolean(status.connected);
  const hasSavedAddress = Boolean(status.address);

  return {
    canConnect: !isBlocked && !isUnsupported,
    canReconnect: !isBlocked && !isUnsupported && hasSavedAddress,
    canDisconnect: !isBlocked && isConnected,
    canTestPrint: !isBlocked && isConnected,
    canForget: !isBlocked && hasSavedAddress
  };
}

/**
 * Get clear, friendly Bangla explanation when a disabled button is tapped.
 *
 * @param {'connect'|'reconnect'|'disconnect'|'test'|'forget'} action
 * @param {object} params
 * @param {object} params.status
 * @param {string|boolean} [params.busy='']
 * @param {boolean} [params.scanning=false]
 * @returns {string} Bangla message explaining why the button cannot be activated
 */
export function getDisabledReason(action, { status = {}, busy = false, scanning = false } = {}) {
  const code = status.status || STATUS.NOT_CONFIGURED;

  if (code === STATUS.PLATFORM_UNSUPPORTED) {
    return 'এই ডিভাইসে ব্লুটুথ প্রিন্টার সমর্থন করে না।';
  }

  if (scanning) {
    return 'ব্লুটুথ ডিভাইস অনুসন্ধান চলছে... অনুগ্রহ করে অপেক্ষা করুন।';
  }

  if (busy || status.connecting) {
    return 'একটি কাজ চলমান রয়েছে। অনুগ্রহ করে অপেক্ষা করুন...';
  }

  const isConnected = code === STATUS.CONNECTED_READY || code === STATUS.FOUND_UNVERIFIED || Boolean(status.connected);
  const hasSavedAddress = Boolean(status.address);

  switch (action) {
    case 'reconnect':
      if (!hasSavedAddress) {
        return 'কোনো সংরক্ষিত প্রিন্টার পাওয়া যায়নি। অনুগ্রহ করে "প্রিন্টার কানেক্ট করুন" থেকে একটি প্রিন্টার নির্বাচন করুন।';
      }
      break;

    case 'disconnect':
      if (!isConnected) {
        return 'প্রিন্টার ইতিমধ্যে ডিসকানেক্ট অবস্থায় আছে।';
      }
      break;

    case 'test':
      if (!isConnected) {
        return 'টেস্ট রসিদ প্রিন্ট করতে প্রথমে একটি প্রিন্টার কানেক্ট করুন।';
      }
      break;

    case 'forget':
      if (!hasSavedAddress) {
        return 'মুছে ফেলার জন্য কোনো সংরক্ষিত প্রিন্টার নেই।';
      }
      break;

    case 'connect':
      break;

    default:
      return 'এই অপশনটি বর্তমানে উপলব্ধ নয়।';
  }

  return 'এই অপশনটি বর্তমানে উপলব্ধ নয়।';
}

