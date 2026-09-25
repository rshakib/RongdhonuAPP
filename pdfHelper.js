import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert, Platform } from 'react-native';
import { formatDisplayDate } from './database';

let isGeneratingPDF = false;

/**
 * Utility to generate and share a PDF using expo-print & expo-sharing.
 * Handles Android scoped storage and Expo Go sandboxing by writing directly
 * into FileSystem.cacheDirectory/documentDirectory before sharing.
 */
async function generateAndSharePDF(html, fileName = 'report.pdf') {
  if (isGeneratingPDF) {
    console.warn("[PDF] Another PDF generation is already in progress.");
    return false;
  }
  isGeneratingPDF = true;

  try {
    // 1. Generate PDF with base64 enabled so it can be written to scoped storage
    const printResult = await Print.printToFileAsync({
      html,
      base64: true,
    });

    let targetUri = printResult.uri;

    // Sanitize filename for Android/iOS file systems
    const safeBaseName = (fileName || 'report.pdf')
      .replace(/[\/\?<>\\:\*\|":]/g, '_')
      .replace(/\s+/g, '_');
    const safeFileName = safeBaseName.endsWith('.pdf') ? safeBaseName : `${safeBaseName}.pdf`;

    // 2. In Expo Go / scoped storage, files generated in host cache outside
    // the experience directory trigger "Not allowed to read file under given URL".
    // Write or copy directly to FileSystem.cacheDirectory / documentDirectory.
    if (FileSystem) {
      const destDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (destDir) {
        const destUri = `${destDir}${safeFileName}`;

        if (printResult.base64) {
          try {
            await FileSystem.writeAsStringAsync(destUri, printResult.base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            targetUri = destUri;
          } catch (writeErr) {
            console.warn("[PDF] FileSystem.writeAsStringAsync failed, falling back to copyAsync:", writeErr);
            try {
              await FileSystem.copyAsync({ from: printResult.uri, to: destUri });
              targetUri = destUri;
            } catch (copyErr) {
              console.warn("[PDF] FileSystem.copyAsync failed, using raw uri:", copyErr);
            }
          }
        } else {
          try {
            await FileSystem.copyAsync({ from: printResult.uri, to: destUri });
            targetUri = destUri;
          } catch (copyErr) {
            console.warn("[PDF] FileSystem.copyAsync failed, using raw uri:", copyErr);
          }
        }
      }
    }

    // 3. Verify sharing availability
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(
        "PDF তৈরি সম্পন্ন",
        `আপনার ডিভাইসে সরাসরি শেয়ারিং সমর্থিত নয়। ফাইলটি তৈরি হয়েছে:\n${targetUri}`
      );
      return true;
    }

    // 4. Share with platform-appropriate options
    const shareOptions = Platform.select({
      ios: {
        UTI: 'com.adobe.pdf',
        mimeType: 'application/pdf',
      },
      default: {
        mimeType: 'application/pdf',
        dialogTitle: safeFileName,
      },
    });

    await Sharing.shareAsync(targetUri, shareOptions);
    return true;
  } catch (err) {
    console.error("PDF Generation error:", err);
    Alert.alert(
      "ত্রুটি",
      `PDF রিপোর্ট তৈরি বা শেয়ার করতে ব্যর্থ হয়েছে।\n${err?.message || ''}`
    );
    return false;
  } finally {
    isGeneratingPDF = false;
  }
}

/**
 * Export Sales Report to PDF
 */
export async function exportSalesReportPDF(orders, filterName = "Daily Sales") {
  const dateStr = formatDisplayDate(new Date());
  const totalAmount = orders.reduce((sum, o) => sum + (o.paidAmount || 0), 0);
  
  const rowsHtml = orders.map((o, idx) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td style="text-align: left;">${o.fullDate ? formatDisplayDate(o.fullDate) : 'Today'}<br/><span style="font-size: 9px; color: #6B7280;">${o.time}</span></td>
      <td style="text-align: center;">${o.tableId}</td>
      <td style="text-align: left; font-size: 10px;">${o.items}</td>
      <td style="text-align: right; font-weight: bold;">৳${o.paidAmount}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Sales Report</title>
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #E5E7EB; padding-bottom: 15px; margin-bottom: 25px; }
        .logo { font-size: 24px; font-weight: bold; color: #1E3A8A; margin-bottom: 5px; }
        .title { font-size: 18px; color: #4B5563; margin-bottom: 5px; }
        .date { font-size: 11px; color: #6B7280; }
        
        .summary-box { background-color: #EFF6FF; border: 1px solid #BFDBFE; padding: 15px; border-radius: 8px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; }
        .summary-label { font-size: 14px; font-weight: 600; color: #1E40AF; }
        .summary-value { font-size: 20px; font-weight: bold; color: #1E3A8A; }

        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background-color: #1E3A8A; color: white; padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
        td { padding: 12px 8px; border-bottom: 1px solid #E5E7EB; font-size: 11px; }
        .alt-row { background-color: #F9FAFB; }
        
        .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">Rongdhonu Café & Restaurant</div>
        <div class="title">Sales Report - ${filterName}</div>
        <div class="date">Generated on: ${dateStr}</div>
      </div>

      <div class="summary-box">
        <span class="summary-label">TOTAL SALES REVENUE</span>
        <span class="summary-value">৳${totalAmount.toLocaleString()}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 20%;">Date/Time</th>
            <th style="width: 10%; text-align: center;">Table</th>
            <th style="width: 55%;">Items Ordered</th>
            <th style="width: 15%; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="footer">
        &copy; ${new Date().getFullYear()} Rongdhonu Café & Restaurant Management System
      </div>
    </body>
    </html>
  `;

  const safeFilterTitle = (filterName || 'Daily-Sales').toString().replace(/\s+/g, '-');
  return await generateAndSharePDF(html, `sales-report-${safeFilterTitle}.pdf`);
}

/**
 * Export Deposit Report / Monthly Summary to PDF
 */
export async function exportDepositReportPDF(history, monthName = "জমা রিপোর্ট") {
  const dateStr = formatDisplayDate(new Date());
  const records = Array.isArray(history) ? history : [];
  
  const totalSell = records.reduce((sum, i) => sum + (Number(i.sell) || 0), 0);
  const totalBkash = records.reduce((sum, i) => sum + (Number(i.breakdown?.bkash) || 0), 0);
  const totalNagad = records.reduce((sum, i) => sum + (Number(i.breakdown?.nagad) || 0), 0);
  const totalCash = records.reduce((sum, i) => sum + (Number(i.breakdown?.cash) || 0), 0);
  const totalIjara = records.reduce((sum, i) => sum + (Number(i.breakdown?.ijara) || 0), 0);
  
  const totalDudu = records.reduce((sum, i) => sum + (Number(i.breakdown?.dudu) || 0), 0);
  const totalAkash = records.reduce((sum, i) => sum + (Number(i.breakdown?.akash) || 0), 0);
  const totalBurger = records.reduce((sum, i) => sum + (Number(i.breakdown?.burger) || 0), 0);
  const totalBazar = records.reduce((sum, i) => sum + (Number(i.breakdown?.bazar) || 0), 0);
  const totalOthers = records.reduce((sum, i) => sum + (Number(i.breakdown?.others) || 0), 0);
  const totalExpense = records.reduce((sum, i) => sum + (Number(i.expense) || 0), 0);
  const totalDeposit = records.reduce((sum, i) => sum + (Number(i.deposit) || 0), 0);

  const rowsHtml = records.map((item, idx) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td style="text-align: left; font-weight: 500;">
        ${formatDisplayDate(item.date)} 
        ${item.isManualEntry ? '<span class="manual-badge">M</span>' : ''}
      </td>
      <td style="text-align: right; font-weight: bold;">৳${(Number(item.sell) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(Number(item.breakdown?.bkash) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(Number(item.breakdown?.nagad) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(Number(item.breakdown?.cash) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(Number(item.breakdown?.ijara) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #DC2626; font-weight: bold;">৳${(Number(item.expense) || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #059669; font-weight: bold;">৳${(Number(item.deposit) || 0).toLocaleString()}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Deposit Report</title>
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #E5E7EB; padding-bottom: 15px; margin-bottom: 25px; }
        .logo { font-size: 24px; font-weight: bold; color: #1E3A8A; margin-bottom: 5px; }
        .title { font-size: 18px; color: #4B5563; margin-bottom: 5px; }
        .date { font-size: 11px; color: #6B7280; }
        
        /* Dashboard Stats Boxes */
        .stats-row { display: flex; justify-content: space-between; margin-bottom: 25px; gap: 15px; }
        .stat-card { flex: 1; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #E5E7EB; }
        .stat-green { background-color: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
        .stat-red { background-color: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
        .stat-blue { background-color: #EFF6FF; border-color: #BFDBFE; color: #1E40AF; }
        .stat-title { font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 5px; }
        .stat-value { font-size: 20px; font-weight: bold; }

        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        th { background-color: #1E3A8A; color: white; padding: 8px 6px; font-size: 11px; text-transform: uppercase; }
        td { padding: 10px 6px; border-bottom: 1px solid #E5E7EB; }
        .alt-row { background-color: #F9FAFB; }
        
        .manual-badge { background-color: #6B7280; color: white; font-size: 9px; padding: 1px 3px; border-radius: 3px; margin-left: 5px; font-weight: bold; }
        
        .totals-tr { background-color: #F3F4F6; font-weight: bold; }
        .totals-tr td { border-top: 2px solid #9CA3AF; border-bottom: 2px solid #9CA3AF; padding: 12px 6px; font-size: 13px; }

        /* Expenses Breakdown Card */
        .breakdown-card { margin-top: 30px; border: 1px solid #E5E7EB; border-radius: 8px; padding: 15px; background-color: #F9FAFB; }
        .breakdown-title { font-size: 14px; font-weight: bold; color: #374151; margin-bottom: 12px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
        .breakdown-grid { display: flex; flex-wrap: wrap; gap: 15px; }
        .breakdown-item { flex: 1; min-width: 120px; background: white; border: 1px solid #E5E7EB; padding: 10px; border-radius: 6px; text-align: center; }
        .breakdown-label { font-size: 11px; color: #6B7280; margin-bottom: 4px; }
        .breakdown-value { font-size: 14px; font-weight: bold; color: #1E3A8A; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</div>
        <div class="title">জমা ও ব্যয় রিপোর্ট (${monthName})</div>
        <div class="date">রিপোর্ট তৈরির তারিখ: ${dateStr}</div>
      </div>

      <div class="stats-row">
        <div class="stat-card stat-blue">
          <div class="stat-title">মোট বিক্রয় (Total Sell)</div>
          <div class="stat-value">৳${totalSell.toLocaleString()}</div>
        </div>
        <div class="stat-card stat-red">
          <div class="stat-title">মোট ব্যয় (Total Expense)</div>
          <div class="stat-value">৳${totalExpense.toLocaleString()}</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-title">মোট জমা (Net Deposit)</div>
          <div class="stat-value">৳${totalDeposit.toLocaleString()}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="text-align: left;">তারিখ</th>
            <th style="text-align: right;">বিক্রয়</th>
            <th style="text-align: right;">bKash</th>
            <th style="text-align: right;">Nagad</th>
            <th style="text-align: right;">Cash</th>
            <th style="text-align: right;">ইজা</th>
            <th style="text-align: right;">মোট খরচ</th>
            <th style="text-align: right;">জমা</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="totals-tr">
            <td style="text-align: left;">মোট (Total)</td>
            <td style="text-align: right;">৳${totalSell.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalBkash.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalNagad.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalCash.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalIjara.toLocaleString()}</td>
            <td style="text-align: right; color: #DC2626;">৳${totalExpense.toLocaleString()}</td>
            <td style="text-align: right; color: #059669;">৳${totalDeposit.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div class="breakdown-card">
        <div class="breakdown-title">📉 খরচের বিবরণ (Breakdown)</div>
        <div class="breakdown-grid">
          <div class="breakdown-item">
            <div class="breakdown-label">🛍️ দুদু মিয়া</div>
            <div class="breakdown-value">৳${totalDudu.toLocaleString()}</div>
          </div>
          <div class="breakdown-item">
            <div class="breakdown-label">🐔 আকাশ মুরগী</div>
            <div class="breakdown-value">৳${totalAkash.toLocaleString()}</div>
          </div>
          <div class="breakdown-item">
            <div class="breakdown-label">🍔 বার্গার বান</div>
            <div class="breakdown-value">৳${totalBurger.toLocaleString()}</div>
          </div>
          <div class="breakdown-item">
            <div class="breakdown-label">🛒 বাজার খরচ</div>
            <div class="breakdown-value">৳${totalBazar.toLocaleString()}</div>
          </div>
          <div class="breakdown-item">
            <div class="breakdown-label">📦 অন্যান্য খরচ</div>
            <div class="breakdown-value">৳${totalOthers.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const safeMonthTitle = (monthName || 'জমা-রিপোর্ট').toString().replace(/\s+/g, '-');
  return await generateAndSharePDF(html, `deposit-report-${safeMonthTitle}.pdf`);
}
