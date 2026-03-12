# LinkedIn Outreach Bot (Chrome Extension)

Chrome extension (Manifest V3) to automate LinkedIn connection requests with:

- built-in IT/EN templates
- message generation via Groq
- activity sync to Google Apps Script (CRM)

The `popup` and `options` UI is built with React + TypeScript.

## Local Requirements

- Node.js 20+
- npm 10+
- Google Chrome (or Chromium compatible with MV3 extensions)

Quick check:

```bash
node -v
npm -v
```

## Local Setup

From the project root:

```bash
npm install
```

## Build Extension

```bash
npm run build
```

Output is generated in `dist/`.

The build also copies non-React files required by the extension:

- `manifest.json`
- `background.js`
- `content.js`
- `style.css`

## Load in Chrome (Local)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project's `dist` folder

After every change, run `npm run build` again and click **Reload** on the extension.

## Initial Configuration

You can configure credentials in two ways:

- from the popup (`Settings` button)
- from the extension options page (extension menu -> `Options`)

Required fields:

- `Groq API Key`
- `Google Web App URL (CRM)`

Optional field:

- `CRM Webhook Token` (used when `CRM_WEBHOOK_TOKEN` is configured in Apps Script)

## Google Sheets + Apps Script Setup (`Code.gs`)

1. Create or open the Google Sheet you want to use as CRM.
2. Create a sheet tab named `CRM` (or use a custom name and set `CRM_SHEET_NAME`).
3. Set these 12 columns in this exact order:
   - `Company name`
   - `Person Name`
   - `Linkedin URL`
   - `Posizione (Role)`
   - `Cellulare`
   - `Email`
   - `First Reach (yes/no)`
   - `DATA first reach`
   - `DATA second reach`
   - `Status`
   - `Lead Owner`
   - `Notes`
4. From the sheet, open `Extensions -> Apps Script`.
5. Paste `Code.gs` from this repository into the Apps Script project.
6. Open `Project Settings -> Script Properties` and configure:
   - `CRM_SPREADSHEET_ID` (recommended): spreadsheet ID from `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.
   - `CRM_SHEET_NAME` (optional): CRM tab name, default is `CRM`.
   - `CRM_WEBHOOK_TOKEN` (optional but recommended): shared secret to protect the webhook.
7. Deploy as Web App:
   - `Deploy -> New deployment -> Type: Web app`
   - `Execute as`: `Me`
   - `Who has access`: `Anyone`
   - copy the final `/exec` URL (do not use `/dev`).
8. Paste the `/exec` URL into `Google Web App URL (CRM)` in extension options.
9. If `CRM_WEBHOOK_TOKEN` is set in Apps Script, add the same value in extension settings as `CRM Webhook Token` (recommended).
   - Alternative (legacy): append token in querystring:
   - `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<TOKEN>`
10. After each `Code.gs` change, publish a new version in `Manage deployments`; the extension always uses the `/exec` URL.

### Expected Webhook Response

- Success: `{"result":"success"}`
- Error: `{"result":"error","error":"<details>"}`

## Usage Flow

1. Open a LinkedIn profile (`https://www.linkedin.com/in/...`)
2. Open the extension popup
3. Choose mode:
   - `Standard Template`
   - `Groq LLM Generation`
4. Review final message (max 300 chars)
5. (Optional) add CRM notes
6. Click `Automate Connection & Send`

## Useful Commands

```bash
npm run typecheck
npm run build
```

## Main Structure

- `src/popup/` -> React popup UI
- `src/options/` -> React options UI
- `src/lib/` -> TypeScript helpers (Chrome API, templates, types)
- `background.js` -> Groq integration + CRM save
- `content.js` -> LinkedIn DOM automation
- `manifest.json` -> MV3 extension configuration

## Quick Troubleshooting

- **"Open a LinkedIn profile page to start the bot"**
  - You are on a non-profile page. Open a person profile (`/in/`).

- **Profile extraction error**
  - Reload LinkedIn and wait for the profile to fully render.

- **Groq API error**
  - Verify a valid API key in Settings.

- **CRM not updated**
  - Verify the `/exec` URL and an active deployment.
  - If using `CRM_WEBHOOK_TOKEN`, ensure `CRM Webhook Token` is configured in extension settings.
  - Verify the `CRM` tab exists (or that `CRM_SHEET_NAME` is correct).
  - Verify `CRM_SPREADSHEET_ID` in Script Properties.

## Security

- Do not store or commit API keys in local/versioned files.
- Always store settings in `chrome.storage.local` via popup/options.
