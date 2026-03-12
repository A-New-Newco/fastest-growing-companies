const DEFAULT_CRM_SHEET_NAME = "CRM";
const CRM_SPREADSHEET_ID_PROPERTY = "CRM_SPREADSHEET_ID";
const CRM_SHEET_NAME_PROPERTY = "CRM_SHEET_NAME";
const CRM_WEBHOOK_TOKEN_PROPERTY = "CRM_WEBHOOK_TOKEN";

function doPost(e) {
  try {
    const data = parseRequestBody_(e);
    validateWebhookToken_(data, e);

    const sheet = getCrmSheet_();
    const row = buildCrmRow_(data);
    sheet.appendRow(row);

    return jsonResponse_({ result: "success" });
  } catch (error) {
    return jsonResponse_({
      result: "error",
      error: error && error.message ? error.message : "Unknown error",
    });
  }
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Body richiesta mancante.");
  }

  try {
    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== "object") {
      throw new Error("Payload non valido.");
    }
    return data;
  } catch (_error) {
    throw new Error("Body JSON non valido.");
  }
}

function validateWebhookToken_(data, e) {
  const configuredToken = normalizeString_(
    PropertiesService.getScriptProperties().getProperty(CRM_WEBHOOK_TOKEN_PROPERTY)
  );

  if (!configuredToken) {
    return;
  }

  const requestToken = normalizeString_(data.token || (e && e.parameter ? e.parameter.token : ""));
  if (requestToken !== configuredToken) {
    throw new Error("Token webhook non valido.");
  }
}

function getCrmSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = normalizeString_(properties.getProperty(CRM_SPREADSHEET_ID_PROPERTY));
  const sheetName = normalizeString_(properties.getProperty(CRM_SHEET_NAME_PROPERTY)) || DEFAULT_CRM_SHEET_NAME;

  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Spreadsheet non disponibile. Imposta CRM_SPREADSHEET_ID nelle Script Properties.");
  }

  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Foglio "' + sheetName + '" non trovato.');
  }

  return sheet;
}

function buildCrmRow_(data) {
  const source = normalizeString_(data.source).toLowerCase();
  if (source === "extension") {
    return buildExtensionRow_(data);
  }
  return buildFormRow_(data);
}

function buildExtensionRow_(data) {
  const name = normalizeString_(data.name);
  const url = normalizeString_(data.url);

  if (!name) {
    throw new Error('Campo "name" obbligatorio per source=extension.');
  }
  if (!url) {
    throw new Error('Campo "url" obbligatorio per source=extension.');
  }

  const dateSent =
    normalizeString_(data.dateSent) ||
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  return [
    normalizeString_(data.company),
    name,
    url,
    normalizeString_(data.role),
    "",
    "",
    "yes",
    dateSent,
    "",
    "Waiting",
    normalizeString_(data.owner) || "Bot",
    normalizeString_(data.notes),
  ];
}

function buildFormRow_(data) {
  const company = normalizeString_(data.company);
  const name = normalizeString_(data.name);

  if (!company) {
    throw new Error('Campo "company" obbligatorio per source=form.');
  }
  if (!name) {
    throw new Error('Campo "name" obbligatorio per source=form.');
  }

  return [
    company,
    name,
    "",
    normalizeString_(data.role),
    normalizeString_(data.phone),
    normalizeString_(data.email),
    "no",
    "",
    "",
    "Waiting",
    "",
    "Form Submission",
  ];
}

function normalizeString_(value) {
  return value == null ? "" : String(value).trim();
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// Add doGet just to have a visual test if the URL is visited directly in the browser
function doGet(_e) {
  return ContentService.createTextOutput("LinkedIn Outreach CRM Web App is running.");
}
