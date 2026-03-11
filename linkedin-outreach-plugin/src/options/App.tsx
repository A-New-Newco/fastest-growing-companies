import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getSettings, saveSettings } from '../lib/chromeApi';
import type { ExtensionSettings } from '../lib/types';
import '../styles/options.css';

export default function App() {
  const [form, setForm] = useState<ExtensionSettings>({ groqApiKey: '', googleAppUrl: '', crmWebhookToken: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

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

    if (isGoogleUrlInvalid) {
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

  return (
    <main className="options-shell">
      <section className="options-card">
        <header className="options-header">
          <p className="eyebrow">LinkedIn Outreach Bot</p>
          <h1>Extension Settings</h1>
          <p className="subtitle">
            Configure your credentials once. The popup will use these values for message generation and CRM sync.
          </p>
        </header>

        <form className="options-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="groqApiKey">Groq API Key</label>
          <input
            id="groqApiKey"
            type="password"
            placeholder="gsk_..."
            autoComplete="off"
            value={form.groqApiKey}
            onChange={(event) => setForm((prev) => ({ ...prev, groqApiKey: event.target.value }))}
            disabled={isLoading || isSaving}
          />

          <label htmlFor="googleAppUrl">Google Web App URL (CRM)</label>
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

          <label htmlFor="crmWebhookToken">CRM Webhook Token (Optional)</label>
          <input
            id="crmWebhookToken"
            type="password"
            placeholder="Shared secret from Apps Script"
            autoComplete="off"
            value={form.crmWebhookToken}
            onChange={(event) => setForm((prev) => ({ ...prev, crmWebhookToken: event.target.value }))}
            disabled={isLoading || isSaving}
          />

          {isGoogleUrlInvalid && (
            <p className="input-error" role="alert">
              Insert a valid HTTPS URL.
            </p>
          )}

          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={isLoading || isSaving || isGoogleUrlInvalid}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        <div className="meta-help">
          <p>
            Tip: after saving, return to a LinkedIn profile tab and open the extension popup to continue the outreach flow.
          </p>
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
