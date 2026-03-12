import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getSettings, runtimeSendMessage, saveSettings } from '../lib/chromeApi';
import type { ExtensionSettings } from '../lib/types';
import '../styles/options.css';

interface PairingStartResponse {
  pairCode?: string;
  pairSecret?: string;
  expiresAt?: string;
  error?: string;
}

interface PairingCompleteResponse {
  pluginToken?: string;
  pluginTokenExpiresAt?: string;
  error?: string;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  integrationMode: 'dashboard',
  dashboardBaseUrl: '',
  pluginToken: '',
  campaignId: '',
  groqApiKey: '',
  googleAppUrl: '',
  crmWebhookToken: '',
};

export default function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairSecret, setPairSecret] = useState('');
  const [pairExpiresAt, setPairExpiresAt] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getSettings();
        setForm(settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load settings.';
        setErrorMsg(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, []);

  const isDashboardUrlInvalid = useMemo(() => {
    const value = (form.dashboardBaseUrl ?? '').trim();
    if (!value) return false;

    try {
      const parsed = new URL(value);
      return parsed.protocol !== 'https:';
    } catch {
      return true;
    }
  }, [form.dashboardBaseUrl]);

  const isGoogleUrlInvalid = useMemo(() => {
    const value = form.googleAppUrl.trim();
    if (!value) return false;

    try {
      const parsed = new URL(value);
      return parsed.protocol !== 'https:';
    } catch {
      return true;
    }
  }, [form.googleAppUrl]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isDashboardUrlInvalid) {
      setErrorMsg('Dashboard URL must be a valid HTTPS URL.');
      setStatusMsg('');
      return;
    }

    if (form.integrationMode === 'legacy' && isGoogleUrlInvalid) {
      setErrorMsg('Google Web App URL must be a valid HTTPS URL.');
      setStatusMsg('');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');

    try {
      await saveSettings(form);
      setStatusMsg('Settings saved successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save settings.';
      setErrorMsg(message);
      setStatusMsg('');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePairingStart = async () => {
    setIsPairing(true);
    setErrorMsg('');
    setStatusMsg('');

    try {
      const response = await runtimeSendMessage<{ type: 'PLUGIN_START_PAIRING' }, PairingStartResponse>({
        type: 'PLUGIN_START_PAIRING',
      });

      if (response.error || !response.pairCode || !response.pairSecret) {
        throw new Error(response.error || 'Unable to start pairing.');
      }

      setPairCode(response.pairCode);
      setPairSecret(response.pairSecret);
      setPairExpiresAt(response.expiresAt ?? '');
      setStatusMsg('Pairing session created. Complete pairing from the dashboard account.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pairing start failed.';
      setErrorMsg(message);
      setStatusMsg('');
    } finally {
      setIsPairing(false);
    }
  };

  const handlePairingComplete = async () => {
    if (!pairCode.trim() || !pairSecret.trim()) {
      setErrorMsg('pairCode and pairSecret are required. Start pairing first.');
      setStatusMsg('');
      return;
    }

    setIsPairing(true);
    setErrorMsg('');
    setStatusMsg('');

    try {
      const response = await runtimeSendMessage<
        {
          type: 'PLUGIN_COMPLETE_PAIRING';
          payload: { pairCode: string; pairSecret: string };
        },
        PairingCompleteResponse
      >({
        type: 'PLUGIN_COMPLETE_PAIRING',
        payload: { pairCode: pairCode.trim(), pairSecret: pairSecret.trim() },
      });

      if (response.error || !response.pluginToken) {
        throw new Error(response.error || 'Pairing completion failed.');
      }

      const next = { ...form, pluginToken: response.pluginToken };
      setForm(next);
      await saveSettings(next);

      setStatusMsg(
        response.pluginTokenExpiresAt
          ? `Plugin token stored. Expires at: ${response.pluginTokenExpiresAt}`
          : 'Plugin token stored.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pairing completion failed.';
      setErrorMsg(message);
      setStatusMsg('');
    } finally {
      setIsPairing(false);
    }
  };

  return (
    <main className="options-shell">
      <section className="options-card">
        <header className="options-header">
          <p className="eyebrow">LinkedIn Outreach Bot</p>
          <h1>Extension Settings</h1>
          <p className="subtitle">
            Configure dashboard integration (default) or keep legacy CRM mode during migration.
          </p>
        </header>

        <form className="options-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="integrationMode">Integration Mode</label>
          <select
            id="integrationMode"
            value={form.integrationMode}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                integrationMode: event.target.value === 'legacy' ? 'legacy' : 'dashboard',
              }))
            }
            disabled={isLoading || isSaving}
          >
            <option value="dashboard">Dashboard (default)</option>
            <option value="legacy">Legacy (Google CRM)</option>
          </select>

          <label htmlFor="dashboardBaseUrl">Dashboard Base URL</label>
          <input
            id="dashboardBaseUrl"
            type="url"
            placeholder="https://dashboard.example.com"
            autoComplete="off"
            value={form.dashboardBaseUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, dashboardBaseUrl: event.target.value }))}
            disabled={isLoading || isSaving}
            aria-invalid={isDashboardUrlInvalid}
          />

          <label htmlFor="pluginToken">Plugin Token</label>
          <input
            id="pluginToken"
            type="password"
            placeholder="ptk_..."
            autoComplete="off"
            value={form.pluginToken}
            onChange={(event) => setForm((prev) => ({ ...prev, pluginToken: event.target.value }))}
            disabled={isLoading || isSaving}
          />

          <label htmlFor="campaignId">Default Campaign ID</label>
          <input
            id="campaignId"
            type="text"
            placeholder="UUID"
            autoComplete="off"
            value={form.campaignId}
            onChange={(event) => setForm((prev) => ({ ...prev, campaignId: event.target.value }))}
            disabled={isLoading || isSaving}
          />

          {form.integrationMode === 'legacy' && (
            <>
              <label htmlFor="groqApiKey">Groq API Key (Legacy)</label>
              <input
                id="groqApiKey"
                type="password"
                placeholder="gsk_..."
                autoComplete="off"
                value={form.groqApiKey}
                onChange={(event) => setForm((prev) => ({ ...prev, groqApiKey: event.target.value }))}
                disabled={isLoading || isSaving}
              />

              <label htmlFor="googleAppUrl">Google Web App URL (Legacy CRM)</label>
              <input
                id="googleAppUrl"
                type="url"
                placeholder="https://script.google.com/..."
                autoComplete="off"
                value={form.googleAppUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, googleAppUrl: event.target.value }))}
                disabled={isLoading || isSaving}
                aria-invalid={isGoogleUrlInvalid}
              />

              <label htmlFor="crmWebhookToken">CRM Webhook Token (Legacy, Optional)</label>
              <input
                id="crmWebhookToken"
                type="password"
                placeholder="Shared secret from Apps Script"
                autoComplete="off"
                value={form.crmWebhookToken}
                onChange={(event) => setForm((prev) => ({ ...prev, crmWebhookToken: event.target.value }))}
                disabled={isLoading || isSaving}
              />
            </>
          )}

          {isDashboardUrlInvalid && (
            <p className="input-error" role="alert">
              Insert a valid HTTPS Dashboard URL.
            </p>
          )}

          {form.integrationMode === 'legacy' && isGoogleUrlInvalid && (
            <p className="input-error" role="alert">
              Insert a valid HTTPS URL.
            </p>
          )}

          <div className="button-row">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={
                isLoading ||
                isSaving ||
                isDashboardUrlInvalid ||
                (form.integrationMode === 'legacy' && isGoogleUrlInvalid)
              }
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        <div className="meta-help">
          <p>Device pairing (dashboard mode):</p>
          <div className="button-row">
            <button className="btn btn-secondary" type="button" onClick={() => void handlePairingStart()} disabled={isPairing}>
              {isPairing ? 'Starting...' : 'Start Pairing'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void handlePairingComplete()} disabled={isPairing}>
              {isPairing ? 'Completing...' : 'Complete Pairing'}
            </button>
          </div>
          <p>pairCode: {pairCode || '—'}</p>
          <p>pairSecret: {pairSecret || '—'}</p>
          <p>expiresAt: {pairExpiresAt || '—'}</p>
        </div>

        <div className={`message message-success${statusMsg ? ' is-visible' : ''}`} role="status">
          {statusMsg}
        </div>
        <div className={`message message-error${errorMsg ? ' is-visible' : ''}`} role="alert">
          {errorMsg}
        </div>
      </section>
    </main>
  );
}
