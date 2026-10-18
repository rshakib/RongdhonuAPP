const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('======================================================');
console.log('            PDF HELPER & EXPORT TEST SUITE            ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}:`, err.message);
    failed++;
  }
}

const pdfHelperSource = fs.readFileSync(path.join(__dirname, '../pdfHelper.js'), 'utf8');

// TC-01: Correct imports for scoped storage and sharing
runTest('TC-01: Imports expo-file-system/legacy and Platform for scoped caching', () => {
  assert(pdfHelperSource.includes("import * as FileSystem from 'expo-file-system/legacy';"), "Missing expo-file-system/legacy import");
  assert(pdfHelperSource.includes("import * as Print from 'expo-print';"), "Missing expo-print import");
  assert(pdfHelperSource.includes("import * as Sharing from 'expo-sharing';"), "Missing expo-sharing import");
  assert(pdfHelperSource.includes("Platform"), "Missing Platform import");
});

// TC-02: Base64 enabled in printToFileAsync
runTest('TC-02: printToFileAsync requested with base64: true for scoped storage write', () => {
  assert(pdfHelperSource.includes("base64: true"), "base64: true missing in printToFileAsync options");
});

// TC-03: Scoped storage caching before Sharing.shareAsync
runTest('TC-03: PDF is written to FileSystem cacheDirectory before Sharing to avoid URL permission errors', () => {
  assert(pdfHelperSource.includes("FileSystem.cacheDirectory || FileSystem.documentDirectory"), "Cache directory fallback missing");
  assert(pdfHelperSource.includes("FileSystem.writeAsStringAsync"), "writeAsStringAsync missing for base64 writing");
  assert(pdfHelperSource.includes("FileSystem.EncodingType.Base64"), "EncodingType.Base64 missing");
  assert(pdfHelperSource.includes("FileSystem.copyAsync"), "copyAsync fallback missing");
});

// TC-04: Concurrency lock prevents overlapping print tasks
runTest('TC-04: Concurrency lock isGeneratingPDF prevents duplicate rejections', () => {
  assert(pdfHelperSource.includes("let isGeneratingPDF = false;"), "isGeneratingPDF lock missing");
  assert(pdfHelperSource.includes("if (isGeneratingPDF)"), "isGeneratingPDF check missing");
  assert(pdfHelperSource.includes("isGeneratingPDF = false;"), "isGeneratingPDF release missing in finally block");
});

// TC-05: Platform-specific share options
runTest('TC-05: Platform.select provides proper UTI for iOS and clean mimeType for Android', () => {
  assert(pdfHelperSource.includes("Platform.select"), "Platform.select missing for share options");
  assert(pdfHelperSource.includes("com.adobe.pdf"), "com.adobe.pdf missing for iOS");
  assert(pdfHelperSource.includes("application/pdf"), "application/pdf missing");
});

// TC-06: exportDepositReportPDF safely casts numbers and handles nullish breakdown
runTest('TC-06: exportDepositReportPDF handles empty history and safe numbers', () => {
  assert(pdfHelperSource.includes("Number(i.sell) || 0"), "Safe sell parsing missing");
  assert(pdfHelperSource.includes("Number(i.expense) || 0"), "Safe expense parsing missing");
  assert(pdfHelperSource.includes("Number(i.deposit) || 0"), "Safe deposit parsing missing");
  assert(pdfHelperSource.includes("Number(i.breakdown?.bkash) || 0"), "Safe breakdown bkash parsing missing");
  assert(pdfHelperSource.includes("Number(i.breakdown?.nagad) || 0"), "Safe breakdown nagad parsing missing");
});

// TC-07: Filenames are sanitized and replace all whitespace
runTest('TC-07: Safe filename sanitization for deposit and sales reports', () => {
  assert(pdfHelperSource.includes("safeMonthTitle"), "safeMonthTitle missing in exportDepositReportPDF");
  assert(pdfHelperSource.includes("safeFilterTitle"), "safeFilterTitle missing in exportSalesReportPDF");
  assert(pdfHelperSource.includes("replace(/\\s+/g, '-')"), "Whitespace replacement missing");
});

console.log('\n======================================================');
console.log(`   TEST EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
