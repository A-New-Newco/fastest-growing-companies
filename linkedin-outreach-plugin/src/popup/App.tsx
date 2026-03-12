import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  executeScriptInTab,
  getSettings,
  openOptionsPage,
  queryActiveTab,
  runtimeSendMessage,
  sendMessageToTab
} from '../lib/chromeApi';
import { buildTemplate, sanitizeName } from '../lib/templates';
import type { ExtensionSettings, Language, MessageMode, ProfileData } from '../lib/types';
import '../styles/popup.css';

interface GroqMessage {
  type: 'CALL_GROQ';
  payload: {
    prompt: string;
    systemPrompt: string;
    modelOverride?: string;
  };
}

interface GroqResponse {
  text?: string;
  error?: string;
}

interface ProfileResponse extends Partial<ProfileData> {
  error?: string;
}

interface AutomationResponse {
  success?: boolean;
  error?: string;
}

function isLinkedInProfileUrl(url?: string): boolean {
  return Boolean(url?.includes('linkedin.com/in/'));
}

function isReceivingEndMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('receiving end does not exist') ||
    message.includes('could not establish connection')
  );
}

const PROFILE_CONNECTION_ERROR_MESSAGE =
  'LinkedIn profile detected, but the extension could not connect to this page. Refresh the profile page and reopen the popup.';

function buildFirstNameExtractionPrompt(profile: ProfileData): GroqMessage {
  return {
    type: 'CALL_GROQ',
    payload: {
      prompt:
        'Please extract ONLY the first name of this person. Return NOTHING else. Here is their profile name text: ' +
        profile.fullName +
        '. Here is their LinkedIn URL to help you deduce the name from the slug: ' +
        profile.url,
      systemPrompt:
        'You are a helpful assistant that only outputs the extracted first name. No pleasantries, no markdown, just the single first name.',
      modelOverride: 'llama-3.1-8b-instant'
    }
  };
}

function buildGenerationPrompt(prompt: string, profile: ProfileData): GroqMessage {
  return {
    type: 'CALL_GROQ',
    payload: {
      prompt,
      systemPrompt:
        'You are an expert representative writing a LinkedIn connection request note for ' +
        profile.fullName +
        '.\n' +
        'Their headline is: "' +
        profile.headline +
        '".\n' +
        'Keep the message under 280 characters. Be concise, professional yet friendly. Do not use placeholders.'
    }
  };
}

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>({ groqApiKey: '', googleAppUrl: '', crmWebhookToken: '' });

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [showBotPanel, setShowBotPanel] = useState(false);
  const [isLinkedInProfileTab, setIsLinkedInProfileTab] = useState(false);
  const [hasProfileConnectionIssue, setHasProfileConnectionIssue] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [extractingFirstName, setExtractingFirstName] = useState(false);

  const [mode, setMode] = useState<MessageMode>('template');
  const [selectedLang, setSelectedLang] = useState<Language>('IT');
  const [llmPrompt, setLlmPrompt] = useState('');
  const [finalMessage, setFinalMessage] = useState('');
  const [crmNotes, setCrmNotes] = useState('');

  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutomating, setIsAutomating] = useState(false);

  const charCount = finalMessage.length;
  const isMessageTooLong = charCount > 300;
  const isMessageNearLimit = charCount >= 260 && charCount <= 300;

  const missingGroq = !settings.groqApiKey.trim();
  const missingGoogle = !settings.googleAppUrl.trim();
  const settingsMissing = missingGroq || missingGoogle;

  const showStatus = useCallback((message: string) => {
    setStatusMsg(message);
    setErrorMsg('');
  }, []);

  const showError = useCallback((message: string) => {
    setErrorMsg(message);
    setStatusMsg('');
  }, []);

  const refreshSettings = useCallback(async () => {
    const loadedSettings = await getSettings();
    setSettings(loadedSettings);
  }, []);

  const applyTemplate = useCallback(
    (language: Language, loadedProfile: ProfileData) => {
      setFinalMessage(buildTemplate(language, loadedProfile.name));
    },
    []
  );

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    setExtractingFirstName(false);
    setHasProfileConnectionIssue(false);

    try {
      const activeTab = await queryActiveTab();
      const isProfileTab = Boolean(activeTab?.id && isLinkedInProfileUrl(activeTab.url));
      setIsLinkedInProfileTab(isProfileTab);

      if (!isProfileTab || !activeTab?.id) {
        setProfile(null);
        setShowBotPanel(false);
        setHasProfileConnectionIssue(false);
        setErrorMsg('');
        setStatusMsg('');
        return;
      }

      let response: ProfileResponse;
      try {
        response = await sendMessageToTab<{ type: 'GET_PROFILE' }, ProfileResponse>(activeTab.id, {
          type: 'GET_PROFILE'
        });
      } catch (error) {
        if (!isReceivingEndMissingError(error)) {
          throw error;
        }

        await executeScriptInTab(activeTab.id, ['content.js']);
        response = await sendMessageToTab<{ type: 'GET_PROFILE' }, ProfileResponse>(activeTab.id, {
          type: 'GET_PROFILE'
        });
      }

      if (!response || response.error || !response.fullName) {
        throw new Error('Could not extract profile. Wait for the page to load or refresh.');
      }

      const loadedProfile: ProfileData = {
        name: response.name ?? '',
        fullName: response.fullName,
        headline: response.headline ?? '',
        company: response.company ?? '',
        location: response.location ?? '',
        url: response.url ?? activeTab.url ?? '',
        isItalian: Boolean(response.isItalian)
      };

      const initialLanguage: Language = loadedProfile.isItalian ? 'IT' : 'EN';
      setProfile(loadedProfile);
      setSelectedLang(initialLanguage);
      applyTemplate(initialLanguage, loadedProfile);
      setShowBotPanel(true);
      setHasProfileConnectionIssue(false);

      setExtractingFirstName(true);
      try {
        const nameResponse = await runtimeSendMessage<GroqMessage, GroqResponse>(
          buildFirstNameExtractionPrompt(loadedProfile)
        );

        if (nameResponse?.text && !nameResponse.error) {
          const extractedName = sanitizeName(nameResponse.text);
          if (extractedName) {
            const mergedProfile = { ...loadedProfile, name: extractedName };
            setProfile(mergedProfile);
            applyTemplate(initialLanguage, mergedProfile);
          }
        }
      } catch {
        // Keep extracted name from page if Groq is not configured or not reachable.
      } finally {
        setExtractingFirstName(false);
      }
    } catch (error) {
      const isConnectionIssue = isReceivingEndMissingError(error);
      setHasProfileConnectionIssue(isConnectionIssue);

      const message = isConnectionIssue
        ? PROFILE_CONNECTION_ERROR_MESSAGE
        : error instanceof Error
          ? error.message
          : 'Unknown error while reading profile.';
      showError(message);
      setShowBotPanel(false);
    } finally {
      setLoadingProfile(false);
    }
  }, [applyTemplate, showError]);

  useEffect(() => {
    void refreshSettings();
    void loadProfile();

    const onFocus = () => {
      void refreshSettings();
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadProfile, refreshSettings]);

  useEffect(() => {
    if (mode === 'template' && profile) {
      applyTemplate(selectedLang, profile);
    }
  }, [applyTemplate, mode, profile, selectedLang]);

  const targetLabel = useMemo(() => {
    if (!profile) return 'Loading...';

    if (extractingFirstName) {
      return `${profile.fullName} (Extracting First Name...)`;
    }

    return `${profile.fullName} (Name: ${profile.name})`;
  }, [extractingFirstName, profile]);

  const handleOpenOptions = async () => {
    try {
      await openOptionsPage();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open options page.';
      showError(message);
    }
  };

  const handleGenerate = async () => {
    if (!profile) return;
    if (missingGroq) {
      showError('Groq API Key missing. Configure it in Settings.');
      return;
    }

    setIsGenerating(true);
    showStatus('Generating message...');

    try {
      const response = await runtimeSendMessage<GroqMessage, GroqResponse>(
        buildGenerationPrompt(llmPrompt, profile)
      );

      if (response?.error) {
        throw new Error(`API Error: ${response.error}`);
      }

      if (!response?.text) {
        throw new Error('Unknown error communicating with background script.');
      }

      const generated = response.text.trim().replace(/^"|"$/g, '');
      setFinalMessage(generated);
      showStatus('Message generated!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate message.';
      showError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendAutomation = async () => {
    if (!profile) return;

    if (isMessageTooLong) {
      showError('Message exceeds 300 chars!');
      return;
    }

    if (missingGoogle) {
      showError('Google Web App URL missing. Configure it in Settings.');
      return;
    }

    setIsAutomating(true);
    showStatus('Automating... DO NOT CLOSE THIS POPUP.');

    try {
      const activeTab = await queryActiveTab();
      if (!activeTab?.id) {
        throw new Error('No active tab found.');
      }

      const response = await sendMessageToTab<
        {
          type: 'START_AUTOMATION';
          payload: {
            message: string;
            type: 'LLM' | 'Template';
            userNotes: string;
          };
        },
        AutomationResponse
      >(activeTab.id, {
        type: 'START_AUTOMATION',
        payload: {
          message: finalMessage,
          type: mode === 'llm' ? 'LLM' : 'Template',
          userNotes: crmNotes
        }
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      showStatus('Done! Outreach sent and saved to CRM.');
      window.setTimeout(() => window.close(), 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation failed.';
      showError(message);
      setIsAutomating(false);
    }
  };

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

      {settingsMissing && (
        <section className="card notice-panel" role="status" aria-live="polite">
          <p className="notice-title">Setup required</p>
          <p className="notice-text">
            {missingGroq && missingGoogle
              ? 'Add Groq API Key and Google Web App URL in Settings.'
              : missingGroq
                ? 'Add Groq API Key in Settings to enable message generation.'
                : 'Add Google Web App URL in Settings to save outreach in CRM.'}
          </p>
          <button className="btn btn-secondary btn-inline" type="button" onClick={() => void handleOpenOptions()}>
            Open Settings
          </button>
        </section>
      )}

      {showBotPanel ? (
        <section id="botPanel" aria-label="Outreach bot panel">
          <div className="card section">
            <p className="label-inline">Target</p>
            <p id="targetName" className="target-name">
              {targetLabel}
            </p>
          </div>

          <div className="card section">
            <label htmlFor="modeSelect">Mode</label>
            <select
              id="modeSelect"
              value={mode}
              onChange={(event) => setMode(event.target.value as MessageMode)}
            >
              <option value="template">Standard Template</option>
              <option value="llm">Groq LLM Generation</option>
            </select>
          </div>

          {mode === 'llm' && (
            <div id="llmContainer" className="card section">
              <label htmlFor="llmPrompt">Prompt for LLM</label>
              <textarea
                id="llmPrompt"
                rows={3}
                placeholder="E.g. Condividi un pensiero logistico su..."
                value={llmPrompt}
                onChange={(event) => setLlmPrompt(event.target.value)}
              />
              <button
                id="generateBtn"
                className={`btn btn-secondary${isGenerating ? ' is-loading' : ''}`}
                type="button"
                aria-busy={isGenerating}
                disabled={isGenerating || !profile || missingGroq}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? 'Generating...' : 'Generate via Groq'}
              </button>
            </div>
          )}

          <div className="card section">
            <label htmlFor="finalMessage">Final Message</label>
            <textarea
              id="finalMessage"
              rows={5}
              value={finalMessage}
              onChange={(event) => setFinalMessage(event.target.value)}
            />
            <div className="meta-row">
              <div id="langToggle" className="segmented" role="group" aria-label="Message language">
                <button
                  className={`btn btn-secondary btn-segment${selectedLang === 'IT' ? ' active-lang' : ''}`}
                  id="btnIt"
                  type="button"
                  onClick={() => setSelectedLang('IT')}
                >
                  IT
                </button>
                <button
                  className={`btn btn-secondary btn-segment${selectedLang === 'EN' ? ' active-lang' : ''}`}
                  id="btnEn"
                  type="button"
                  onClick={() => setSelectedLang('EN')}
                >
                  EN
                </button>
              </div>
              <div
                id="charCount"
                className={isMessageTooLong ? 'alert' : isMessageNearLimit ? 'warning' : ''}
              >
                {charCount} / 300
              </div>
            </div>
          </div>

          <div className="card section">
            <label htmlFor="crmNotes">CRM Notes (Optional)</label>
            <textarea
              id="crmNotes"
              rows={2}
              placeholder="Private notes for the CRM..."
              value={crmNotes}
              onChange={(event) => setCrmNotes(event.target.value)}
            />
          </div>

          <button
            id="sendBtn"
            className={`btn btn-primary${isAutomating ? ' is-loading' : ''}`}
            type="button"
            disabled={
              !profile ||
              loadingProfile ||
              isAutomating ||
              isGenerating ||
              isMessageTooLong ||
              missingGoogle
            }
            aria-busy={isAutomating}
            onClick={() => void handleSendAutomation()}
          >
            {isAutomating ? 'Automating...' : 'Automate Connection & Send'}
          </button>
        </section>
      ) : loadingProfile ? (
        <section id="notLinkedInPanel" className="card empty-state" role="status">
          Loading profile context...
        </section>
      ) : hasProfileConnectionIssue ? (
        <section id="profileConnectionPanel" className="card empty-state" role="status">
          Profile detected, but the extension could not connect. Refresh this LinkedIn profile page.
        </section>
      ) : isLinkedInProfileTab ? (
        <section id="profileDataPanel" className="card empty-state" role="status">
          Profile detected, but data is not ready yet. Wait for the page to load or refresh.
        </section>
      ) : (
        <section id="notLinkedInPanel" className="card empty-state" role="status">
          Open a LinkedIn profile page to start the bot.
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
