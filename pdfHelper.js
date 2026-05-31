import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { formatDisplayDate } from './database';

/**
 * Utility to generate and share a PDF using expo-print & expo-sharing
 */
async function generateAndSharePDF(htmlContent, fileName) {
  try {
    // 1. Generate the PDF file locally
    const { uri } = await Print.printToFileAsync({ html: htmlContent });
    
    // 2. Check if native Sharing is available
    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (isSharingAvailable) {
      try {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share/Save ${fileName}`,
          UTI: 'com.adobe.pdf',
        });
        return true;
      } catch (shareError) {
        // If sharing fails (e.g. user dismissed or cancelled the share drawer)
        console.log("Sharing dismissed or failed, falling back to print dialog:", shareError);
      }
    }
    
    // 3. Fallback to OS Print preview directly
    await Print.printAsync({ html: htmlContent });
    return true;
  } catch (error) {
    console.error("PDF Export Error:", error);
    
    // Last resort fallback
    try {
      await Print.printAsync({ html: htmlContent });
      return true;
    } catch (printError) {
      console.error("Print fallback failed:", printError);
      Alert.alert("ত্রুটি", "PDF জেনারেট বা প্রিন্ট করার সময় একটি সমস্যা হয়েছে।");
      return false;
    }
  }
}

/**
 * Export Sales Report to PDF
 */
export async function exportSalesReportPDF(orders, filterName = "Sales Report") {
  const dateStr = formatDisplayDate(new Date());
  const totalPaid = orders.reduce((sum, o) => sum + (o.paidAmount || 0), 0);

  const rowsHtml = orders.map((order, idx) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td style="width: 25%; text-align: left;">
        <div class="main-text">${order.fullDate ? formatDisplayDate(order.fullDate) : 'আজ'}</div>
        <div class="sub-text">${order.time || ''}</div>
      </td>
      <td style="width: 15%; text-align: center; font-weight: bold;">
        ${order.tableId}
        ${order.deliveryCharge > 0 ? `<div style="font-size: 10px; color: #6B7280; font-weight: normal; margin-top: 4px;">ডেলিভারি চার্জ: ৳${order.deliveryCharge}</div>` : ''}
      </td>
      <td style="width: 45%; text-align: left; color: #D97706; font-size: 13px;">${order.items || ''}</td>
      <td style="width: 15%; text-align: right; font-weight: bold; color: #059669;">৳${(order.paidAmount || 0).toLocaleString()}</td>
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
        .header { text-align: center; border-bottom: 2px solid #E5E7EB; padding-bottom: 15px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #1E3A8A; margin-bottom: 5px; }
        .title { font-size: 18px; color: #4B5563; margin-bottom: 5px; }
        .date { font-size: 12px; color: #6B7280; }
        
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background-color: #1E3A8A; color: white; padding: 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 12px 10px; border-bottom: 1px solid #E5E7EB; font-size: 14px; }
        .alt-row { background-color: #F9FAFB; }
        
        .main-text { font-weight: 500; }
        .sub-text { font-size: 11px; color: #6B7280; margin-top: 2px; }
        
        .footer { margin-top: 30px; border-top: 2px solid #E5E7EB; padding-top: 15px; text-align: right; }
        .total-box { display: inline-block; background-color: #ECFDF5; border: 1px solid #A7F3D0; padding: 10px 20px; border-radius: 6px; }
        .total-label { font-size: 12px; color: #065F46; font-weight: 600; text-transform: uppercase; }
        .total-amount { font-size: 20px; color: #047857; font-weight: bold; margin-top: 2px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</div>
        <div class="title">বিক্রয় রিপোর্ট (${filterName})</div>
        <div class="date">রিপোর্ট তৈরির তারিখ: ${dateStr}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="text-align: left;">তারিখ ও সময়</th>
            <th style="text-align: center;">টেবিল</th>
            <th style="text-align: left;">আইটেম ও পরিমাণ</th>
            <th style="text-align: right;">বিক্রয়</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="footer">
        <div class="total-box">
          <div class="total-label">মোট বিক্রয় (Total Sales)</div>
          <div class="total-amount">৳${totalPaid.toLocaleString()}</div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await generateAndSharePDF(html, `sales-report-${new Date().getTime()}.pdf`);
}

/**
 * Export Deposit Report / Monthly Summary to PDF
 */
export async function exportDepositReportPDF(history, monthName = "জমা রিপোর্ট") {
  const dateStr = formatDisplayDate(new Date());
  
  const totalSell = history.reduce((sum, i) => sum + (i.sell || 0), 0);
  const totalDudu = history.reduce((sum, i) => sum + (i.breakdown?.dudu || 0), 0);
  const totalAkash = history.reduce((sum, i) => sum + (i.breakdown?.akash || 0), 0);
  const totalBurger = history.reduce((sum, i) => sum + (i.breakdown?.burger || 0), 0);
  const totalBazar = history.reduce((sum, i) => sum + (i.breakdown?.bazar || 0), 0);
  const totalOthers = history.reduce((sum, i) => sum + (i.breakdown?.others || 0), 0);
  const totalExpense = history.reduce((sum, i) => sum + (i.expense || 0), 0);
  const totalDeposit = history.reduce((sum, i) => sum + (i.deposit || 0), 0);

  const rowsHtml = history.map((item, idx) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td style="text-align: left; font-weight: 500;">
        ${formatDisplayDate(item.date)} 
        ${item.isManualEntry ? '<span class="manual-badge">M</span>' : ''}
      </td>
      <td style="text-align: right; font-weight: bold;">৳${(item.sell || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(item.breakdown?.dudu || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(item.breakdown?.akash || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(item.breakdown?.burger || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(item.breakdown?.bazar || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #4B5563;">৳${(item.breakdown?.others || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #DC2626; font-weight: bold;">৳${(item.expense || 0).toLocaleString()}</td>
      <td style="text-align: right; color: #059669; font-weight: bold;">৳${(item.deposit || 0).toLocaleString()}</td>
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
            <th style="text-align: right;">🛍️ দুদু</th>
            <th style="text-align: right;">🐔 আকাশ</th>
            <th style="text-align: right;">🍔 বার্গার</th>
            <th style="text-align: right;">🛒 বাজার</th>
            <th style="text-align: right;">📦 অন্য</th>
            <th style="text-align: right;">মোট খরচ</th>
            <th style="text-align: right;">জমা</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="totals-tr">
            <td style="text-align: left;">মোট (Total)</td>
            <td style="text-align: right;">৳${totalSell.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalDudu.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalAkash.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalBurger.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalBazar.toLocaleString()}</td>
            <td style="text-align: right;">৳${totalOthers.toLocaleString()}</td>
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

  return await generateAndSharePDF(html, `deposit-report-${monthName.replace(' ', '-')}.pdf`);
}
