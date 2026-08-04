/**
 * AI Dataset Sync - Production ML Validation Rules Definition
 * 
 * Target Profile: ADMIN APP ONLY
 * Purpose: Define future validation rules for dataset cleanliness, anomaly detection,
 * and data integrity prior to CSV generation / Google Sheets sync.
 * 
 * ZERO RUNTIME IMPACT: Pure architecture definition.
 */

export const DATASET_VALIDATION_RULES = {
  // 1. Uniqueness & Primary Key Validation
  uniqueness: {
    dailySales: {
      primaryKey: ['business_date'],
      rule: 'DUPLICATE_DATE_REJECTION',
      description: 'Each business date must appear exactly once in daily_sales_dataset.csv'
    },
    itemSales: {
      primaryKey: ['business_date', 'item_name'],
      rule: 'DUPLICATE_ITEM_DATE_REJECTION',
      description: 'Each item name per business date must appear exactly once in item_sales_dataset.csv'
    }
  },

  // 2. Numeric Range & Sanity Rules
  numericBounds: {
    total_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    cash_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    bkash_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    nagad_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    rocket_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    delivery_sales: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    total_expense: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    owner_deposit: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    total_quantity_sold: { min: 0, allowNegative: false, action: 'FLAG_ANOMALY' },
    temperature: { min: -10, max: 60, unit: 'C', action: 'NULLIFY_IF_OUT_OF_BOUNDS' },
    humidity: { min: 0, max: 100, unit: '%', action: 'CLAMP_0_100' },
    is_friday: { allowedValues: [0, 1], action: 'FORCE_BINARY' },
    is_holiday: { allowedValues: [0, 1], action: 'FORCE_BINARY' },
    is_rainy: { allowedValues: [0, 1], action: 'FORCE_BINARY' }
  },

  // 3. Mathematical Consistency Rules
  crossFieldChecks: [
    {
      name: 'PAYMENT_SUM_CHECK',
      formula: 'cash_sales + bkash_sales + nagad_sales + rocket_sales + card_sales === total_sales',
      tolerance: 0.01,
      severity: 'WARNING',
      action: 'FLAG_MISMATCH_ONLY_NEVER_MODIFY_DATA',
      description: 'Cash + Bkash + Nagad + Rocket + Card must equal Total Payment. Flag mismatches in validation_errors but NEVER modify raw financial values.'
    },
    {
      name: 'DEPOSIT_FORMULA_CHECK',
      formula: 'owner_deposit === MAX(0, (total_sales + opening_ijara - total_expense))',
      tolerance: 0.01,
      severity: 'STRICT',
      action: 'FLAG_MISMATCH_ONLY_NEVER_MODIFY_DATA'
    },
    {
      name: 'EXPENSE_RATIO_CHECK',
      formula: 'expense_ratio === (total_expense / NULLIF(total_sales, 0)) * 100',
      tolerance: 0.01,
      severity: 'WARNING'
    }
  ],

  // 4. Missing Value & Null Handling Rules
  nullHandling: {
    business_date: 'REJECT_ROW',
    total_sales: 'DEFAULT_ZERO',
    total_expense: 'DEFAULT_ZERO',
    temperature: 'ALLOW_NULL',
    humidity: 'ALLOW_NULL',
    weather_condition: 'DEFAULT_CLEAR'
  },

  // 5. Training Readiness Flag Rules
  trainingReadiness: {
    ruleName: 'EVALUATE_IS_TRAINING_READY',
    description: 'is_training_ready = 1 ONLY if is_complete === 1 AND is_valid === 1 AND no severe crossFieldChecks failed. Otherwise 0.',
    action: 'SET_BINARY_FLAG'
  }
};

/**
 * Validates a Daily Dataset object against mathematical rules and null bounds.
 * @param {Object} record - Unvalidated daily dataset object
 * @returns {Object} { isValid: boolean, isComplete: boolean, isTrainingReady: boolean, errors: Array<string> }
 */
export function validateDailyDataset(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { isValid: false, isComplete: false, isTrainingReady: false, errors: ['INVALID_OBJECT'] };
  }

  // 1. Uniqueness / Mandatory Key Check
  if (!record.business_date) errors.push('MISSING_BUSINESS_DATE');
  if (!record.dataset_id) errors.push('MISSING_DATASET_ID');

  // 2. Numeric Range & Sanity Check
  if (record.total_sales < 0) errors.push('NEGATIVE_TOTAL_SALES');
  if (record.total_expense < 0) errors.push('NEGATIVE_TOTAL_EXPENSE');
  if (record.total_orders < 0) errors.push('NEGATIVE_TOTAL_ORDERS');

  // 3. Payment Sum Check
  const paymentSum = (Number(record.cash_sales) || 0) +
                     (Number(record.bkash_sales) || 0) +
                     (Number(record.nagad_sales) || 0) +
                     (Number(record.rocket_sales) || 0) +
                     (Number(record.card_sales) || 0);
  const diff = Math.abs(paymentSum - (Number(record.total_sales) || 0));
  if (diff > 0.01) {
    errors.push(`PAYMENT_SUM_MISMATCH:Sum=${paymentSum},Total=${record.total_sales}`);
  }

  const isComplete = !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_DATASET_ID');
  const isValid = errors.length === 0;
  const isTrainingReady = isComplete && isValid;

  return {
    isValid,
    isComplete,
    isTrainingReady,
    errors
  };
}

/**
 * Validates an Item Dataset object against bounds and item identification.
 * @param {Object} record - Unvalidated item dataset object
 * @returns {Object} { isValid: boolean, isComplete: boolean, isTrainingReady: boolean, errors: Array<string> }
 */
export function validateItemDataset(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { isValid: false, isComplete: false, isTrainingReady: false, errors: ['INVALID_OBJECT'] };
  }

  if (!record.business_date) errors.push('MISSING_BUSINESS_DATE');
  if (!record.item_name) errors.push('MISSING_ITEM_NAME');
  if (record.total_quantity_sold < 0) errors.push('NEGATIVE_QUANTITY');
  if (record.total_item_revenue < 0) errors.push('NEGATIVE_REVENUE');

  const isComplete = !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_ITEM_NAME');
  const isValid = errors.length === 0;
  const isTrainingReady = isComplete && isValid;

  return {
    isValid,
    isComplete,
    isTrainingReady,
    errors
  };
}
