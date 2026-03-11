import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  executeScriptInTab,
  getSettings,
  openOptionsPage,
  queryActiveTab,
  runtimeSendMessage,
  sendMessageToTab
} from '../lib/chromeApi';
import type { ExtensionSettings } from '../lib/types';
import LegacyApp from './App';
import '../styles/popup.css';

interface RunResponse {
  id?: string;
  status?: string;
  pauseReason?: string | null;
  error?: string;
}

interface QuotaSnapshot {
  policy?: string;
  dailyLimit?: number;
  hourlyLimit?: number;
  usedDaily?: number;
  usedHourly?: number;
  cooldownRemainingSec?: number;
}

interface ClaimedContact {
  contactId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactRole: string | null;
  contactLinkedin: string | null;
  message: string;
  leaseExpiresAt: string;
  runId: string | null;
}

interface ClaimResponse {
  contact?: ClaimedContact | null;
  quota?: QuotaSnapshot;
  error?: string;
}

interface GenericResponse {
  ok?: boolean;
  status?: string;
  error?: string;
}

interface ParseProfileResponse {
  fullName?: string;
  headline?: string;
  linkedinUrl?: string;
  confidence?: number;
  htmlHash?: string;
  parser?: string;
  error?: string;
}

interface ConfirmProfileResponse {
  userId?: string;
  verifiedAt?: string;
  error?: string;
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isReceivingEndMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('receiving end does not exist') ||
    message.includes('could not establish connection')
  );
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  integrationMode: 'dashboard',
  dashboardBaseUrl: '',
  pluginToken: '',
  campaignId: '',
  groqApiKey: '',
  googleAppUrl: '',
  crmWebhookToken: ''
};

export default function AppDashboard() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [claimed, setClaimed] = useState<ClaimResponse['contact']>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [parsedProfile, setParsedProfile] = useState<ParseProfileResponse | null>(null);
  const [operatorVerifiedAt, setOperatorVerifiedAt] = useState<string | null>(null);

  const showStatus = useCallback((message: string) => {
    setStatusMsg(message);
    setErrorMsg('');
  }, []);

  const showError = useCallback((message: string) => {
    setErrorMsg(message);
    setStatusMsg('');
  }, []);

  const refreshSettings = useCallback(async () => {
    const loaded = await getSettings();
    setSettings({
      ...DEFAULT_SETTINGS,
      ...loaded,
      integrationMode: loaded.integrationMode === 'legacy' ? 'legacy' : 'dashboard',
      dashboardBaseUrl: loaded.dashboardBaseUrl ?? '',
      pluginToken: loaded.pluginToken ?? '',
      campaignId: loaded.campaignId ?? ''
    });
  }, []);

  useEffect(() => {
    void refreshSettings();
    const onFocus = () => void refreshSettings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshSettings]);

  const isDashboardMode = (settings.integrationMode ?? 'dashboard') === 'dashboard';
  const dashboardSettingsMissing = useMemo(
    () =>
      !settings.dashboardBaseUrl?.trim() ||
      !settings.pluginToken?.trim() ||
      !settings.campaignId?.trim(),
    [settings]
  );

  const handleStartRun = async () => {
    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        { type: 'PLUGIN_START_RUN'; payload: { campaignId: string } },
        RunResponse
      >({
        type: 'PLUGIN_START_RUN',
        payload: { campaignId: settings.campaignId ?? '' }
      });

      if (response.error || !response.id) {
        throw new Error(response.error || 'Unable to start run.');
      }

      setRunId(response.id);
      setRunStatus(response.status ?? 'running');
      showStatus(`Run started (${response.id.slice(0, 8)}...)`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to start run.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunAction = async (action: 'pause' | 'resume' | 'stop' | 'complete') => {
    if (!runId) return;
    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        { type: 'PLUGIN_UPDATE_RUN'; payload: { runId: string; action: string } },
        RunResponse
      >({
        type: 'PLUGIN_UPDATE_RUN',
        payload: { runId, action }
      });

      if (response.error) throw new Error(response.error);
      setRunStatus(response.status ?? action);
      showStatus(`Run ${action} completed.`);
      if (action === 'stop' || action === 'complete') {
        setRunId(null);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : `Unable to ${action} run.`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleClaimNext = async () => {
    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        {
          type: 'PLUGIN_CLAIM_NEXT';
          payload: { campaignId: string; runId: string | null; leaseSeconds: number };
        },
        ClaimResponse
      >({
        type: 'PLUGIN_CLAIM_NEXT',
        payload: { campaignId: settings.campaignId ?? '', runId, leaseSeconds: 300 }
      });

      if (response.error) throw new Error(response.error);

      setClaimed(response.contact ?? null);
      setQuota(response.quota ?? null);
      if (!response.contact) {
        showStatus('No pending contact available in this campaign.');
      } else {
        showStatus(`Claimed: ${response.contact.contactName || response.contact.companyName}`);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to claim next contact.');
    } finally {
      setIsBusy(false);
    }
  };

  const withContentScript = async <TRequest, TResponse>(message: TRequest): Promise<TResponse> => {
    const activeTab = await queryActiveTab();
    if (!activeTab?.id) throw new Error('No active tab found.');

    try {
      return await sendMessageToTab<TRequest, TResponse>(activeTab.id, message);
    } catch (error) {
      if (!isReceivingEndMissingError(error)) throw error;
      await executeScriptInTab(activeTab.id, ['content.js']);
      return await sendMessageToTab<TRequest, TResponse>(activeTab.id, message);
    }
  };

  const handlePrepareOnPage = async () => {
    if (!claimed?.message) {
      showError('Claim a contact first.');
      return;
    }
    setIsBusy(true);
    try {
      const response = await withContentScript<
        { type: 'PREPARE_CONNECTION_NOTE'; payload: { message: string } },
        GenericResponse
      >({
        type: 'PREPARE_CONNECTION_NOTE',
        payload: { message: claimed.message }
      });
      if (response?.error) throw new Error(response.error);
      showStatus('Note prepared. Send manually from LinkedIn, then click Mark Contacted.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to prepare note on page.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleMarkContacted = async () => {
    if (!claimed) return;
    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        {
          type: 'PLUGIN_MARK_CONTACTED';
          payload: {
            contactId: string;
            campaignId: string;
            runId: string | null;
            idempotencyKey: string;
            metadata: Record<string, unknown>;
          };
        },
        GenericResponse
      >({
        type: 'PLUGIN_MARK_CONTACTED',
        payload: {
          contactId: claimed.contactId,
          campaignId: settings.campaignId ?? '',
          runId,
          idempotencyKey: makeIdempotencyKey(),
          metadata: { source: 'manual_confirmation' }
        }
      });
      if (response.error) throw new Error(response.error);
      showStatus('Contact marked as contacted.');
      setClaimed(null);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to mark contacted.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleFailContact = async (code: string) => {
    if (!claimed) return;
    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        {
          type: 'PLUGIN_FAIL_CONTACT';
          payload: {
            contactId: string;
            campaignId: string;
            runId: string | null;
            idempotencyKey: string;
            code: string;
            message: string;
          };
        },
        GenericResponse
      >({
        type: 'PLUGIN_FAIL_CONTACT',
        payload: {
          contactId: claimed.contactId,
          campaignId: settings.campaignId ?? '',
          runId,
          idempotencyKey: makeIdempotencyKey(),
          code,
          message: `Failure from popup (${code})`
        }
      });
      if (response.error) throw new Error(response.error);
      showStatus('Failure reported to campaign event log.');
      setClaimed(null);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to report failure.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleParseOperatorProfile = async () => {
    setIsBusy(true);
    try {
      const page = await withContentScript<{ type: 'GET_PAGE_HTML' }, { html?: string; url?: string; error?: string }>({
        type: 'GET_PAGE_HTML'
      });
      if (!page?.html) throw new Error(page?.error || 'Unable to read page HTML.');

      const response = await runtimeSendMessage<
        { type: 'PLUGIN_PARSE_OPERATOR_PROFILE'; payload: { html: string; profileUrl?: string } },
        ParseProfileResponse
      >({
        type: 'PLUGIN_PARSE_OPERATOR_PROFILE',
        payload: { html: page.html, profileUrl: page.url }
      });
      if (response.error) throw new Error(response.error);
      setParsedProfile(response);
      showStatus('Operator profile parsed. Review and confirm.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to parse operator profile.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmOperatorProfile = async () => {
    if (!parsedProfile?.fullName || !parsedProfile?.linkedinUrl || !parsedProfile?.htmlHash) {
      showError('Missing parsed profile data. Parse first.');
      return;
    }

    setIsBusy(true);
    try {
      const response = await runtimeSendMessage<
        {
          type: 'PLUGIN_CONFIRM_OPERATOR_PROFILE';
          payload: {
            fullName: string;
            headline: string;
            linkedinUrl: string;
            confidence: number;
            htmlHash: string;
          };
        },
        ConfirmProfileResponse
      >({
        type: 'PLUGIN_CONFIRM_OPERATOR_PROFILE',
        payload: {
          fullName: parsedProfile.fullName,
          headline: parsedProfile.headline || '',
          linkedinUrl: parsedProfile.linkedinUrl,
          confidence: Number(parsedProfile.confidence ?? 0),
          htmlHash: parsedProfile.htmlHash
        }
      });
      if (response.error) throw new Error(response.error);
      setOperatorVerifiedAt(response.verifiedAt || new Date().toISOString());
      showStatus('Operator profile confirmed.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to confirm operator profile.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenOptions = async () => {
    try {
      await openOptionsPage();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to open settings.');
    }
  };

  if (!isDashboardMode) {
    return <LegacyApp />;
  }

  return (
    <main className="popup-shell">
      <header className="header card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              <path d="M9.2 10.2h2.1v6.2H9.2zm1-3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm2.8 3h2v.8c.5-.6 1.3-1 2.1-1 1.7 0 2.7 1.1 2.7 3.1v3.3h-2.1v-3c0-.9-.3-1.5-1.1-1.5s-1.4.5-1.4 1.5v3h-2.1z" />
            </svg>
          </span>
          <h1>LinkedIn Outreach</h1>
        </div>
        <button className="btn btn-secondary btn-inline" type="button" onClick={() => void handleOpenOptions()}>
          Settings
        </button>
      </header>

      {dashboardSettingsMissing && (
        <section className="card notice-panel" role="status" aria-live="polite">
          <p className="notice-title">Setup required</p>
          <p className="notice-text">
            Configure Dashboard URL, Plugin Token and Campaign ID in Settings.
          </p>
          <button className="btn btn-secondary btn-inline" type="button" onClick={() => void handleOpenOptions()}>
            Open Settings
          </button>
        </section>
      )}

      <section className="card section">
        <p className="label-inline">Campaign</p>
        <p className="target-name">{settings.campaignId || 'No campaign configured'}</p>
        <p className="notice-text">Run: {runId ? `${runStatus} (${runId.slice(0, 8)}...)` : runStatus}</p>
        <div className="button-row">
          <button className="btn btn-primary" type="button" disabled={isBusy || dashboardSettingsMissing} onClick={() => void handleStartRun()}>
            Start
          </button>
          <button className="btn btn-secondary" type="button" disabled={isBusy || !runId} onClick={() => void handleRunAction('pause')}>
            Pause
          </button>
          <button className="btn btn-secondary" type="button" disabled={isBusy || !runId} onClick={() => void handleRunAction('resume')}>
            Resume
          </button>
          <button className="btn btn-secondary" type="button" disabled={isBusy || !runId} onClick={() => void handleRunAction('stop')}>
            Stop
          </button>
        </div>
      </section>

      <section className="card section">
        <p className="label-inline">Operator Profile</p>
        <p className="notice-text">Verified at: {operatorVerifiedAt || 'not verified'}</p>
        <div className="button-row">
          <button className="btn btn-secondary" type="button" disabled={isBusy} onClick={() => void handleParseOperatorProfile()}>
            Parse from page
          </button>
          <button className="btn btn-secondary" type="button" disabled={isBusy || !parsedProfile} onClick={() => void handleConfirmOperatorProfile()}>
            Confirm
          </button>
        </div>
        {parsedProfile && (
          <p className="notice-text">
            {parsedProfile.fullName || '—'} · {parsedProfile.headline || '—'} · {parsedProfile.linkedinUrl || '—'}
          </p>
        )}
      </section>

      <section className="card section">
        <p className="label-inline">Lead Claim</p>
        <div className="button-row">
          <button className="btn btn-primary" type="button" disabled={isBusy || dashboardSettingsMissing} onClick={() => void handleClaimNext()}>
            Claim next
          </button>
          <button className="btn btn-secondary" type="button" disabled={isBusy || !claimed} onClick={() => void handlePrepareOnPage()}>
            Prepare note
          </button>
        </div>
        {claimed ? (
          <>
            <p className="target-name">{claimed.contactName || claimed.companyName}</p>
            <p className="notice-text">{claimed.contactLinkedin || 'No LinkedIn URL'}</p>
            <textarea id="finalMessage" rows={4} value={claimed.message} readOnly />
            <div className="button-row">
              <button className="btn btn-primary" type="button" disabled={isBusy} onClick={() => void handleMarkContacted()}>
                Mark Contacted
              </button>
              <button className="btn btn-secondary" type="button" disabled={isBusy} onClick={() => void handleFailContact('ui_unknown')}>
                Report UI Issue
              </button>
              <button className="btn btn-secondary" type="button" disabled={isBusy} onClick={() => void handleFailContact('captcha')}>
                Report Captcha
              </button>
            </div>
          </>
        ) : (
          <p className="notice-text">No claimed contact yet.</p>
        )}
      </section>

      {quota && (
        <section className="card section">
          <p className="label-inline">Quota</p>
          <p className="notice-text">
            Policy: {quota.policy || '—'} · Daily {quota.usedDaily ?? 0}/{quota.dailyLimit ?? 0} · Hourly {quota.usedHourly ?? 0}/{quota.hourlyLimit ?? 0}
          </p>
          <p className="notice-text">Cooldown remaining: {quota.cooldownRemainingSec ?? 0}s</p>
        </section>
      )}

      <div id="statusMsg" className={`message message-success${statusMsg ? ' is-visible' : ''}`} role="status">
        {statusMsg}
      </div>
      <div id="errorMsg" className={`message message-error${errorMsg ? ' is-visible' : ''}`} role="alert">
        {errorMsg}
      </div>
    </main>
  );
}
