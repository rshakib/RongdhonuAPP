# GOOGLE APPS SCRIPT — WEATHER EXPORTER BACKEND (v1.0.0)
# Purpose: Dedicated handler for legacy Weather Timeline exports

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Invalid request postData");
    }

    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("Weather_Timeline_Dataset");
    var tabName = "Weather_Timeline";
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "BusinessDate", "Timestamp", "Temperature", "Humidity", 
        "WindSpeed", "WeatherCondition", "IsRainy", "DayOfWeek", 
        "HourOfDay", "IsWeekend", "Month"
      ]);
    }

    sheet.appendRow([
      payload.BusinessDate || "",
      payload.Timestamp || "",
      payload.Temperature || "",
      payload.Humidity || "",
      payload.WindSpeed || "",
      payload.WeatherCondition || "",
      payload.IsRainy || "",
      payload.DayOfWeek || "",
      payload.HourOfDay || "",
      payload.IsWeekend || "",
      payload.Month || ""
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: "Weather recorded" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
