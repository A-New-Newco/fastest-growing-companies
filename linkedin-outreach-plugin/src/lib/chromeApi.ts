import type { ExtensionSettings } from './types';

const SETTINGS_KEYS = [
  'integrationMode',
  'dashboardBaseUrl',
  'pluginToken',
  'campaignId',
  'groqApiKey',
  'googleAppUrl',
  'crmWebhookToken',
] as const;

type SettingsKey = (typeof SETTINGS_KEYS)[number];

type RawSettings = Partial<Record<SettingsKey, string>>;

function runtimeErrorMessage(): string | null {
  return chrome.runtime.lastError?.message ?? null;
}

export function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([...SETTINGS_KEYS], (stored: RawSettings) => {
      resolve({
        integrationMode: stored.integrationMode === 'legacy' ? 'legacy' : 'dashboard',
        dashboardBaseUrl: stored.dashboardBaseUrl ?? '',
        pluginToken: stored.pluginToken ?? '',
        campaignId: stored.campaignId ?? '',
        groqApiKey: stored.groqApiKey ?? '',
        googleAppUrl: stored.googleAppUrl ?? '',
        crmWebhookToken: stored.crmWebhookToken ?? ''
      });
    });
  });
}

export function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        integrationMode: settings.integrationMode === 'legacy' ? 'legacy' : 'dashboard',
        dashboardBaseUrl: (settings.dashboardBaseUrl ?? '').trim().replace(/\/+$/, ''),
        pluginToken: (settings.pluginToken ?? '').trim(),
        campaignId: (settings.campaignId ?? '').trim(),
        groqApiKey: settings.groqApiKey.trim(),
        googleAppUrl: settings.googleAppUrl.trim(),
        crmWebhookToken: settings.crmWebhookToken.trim()
      },
      () => resolve()
    );
  });
}

export function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

export function runtimeSendMessage<TRequest, TResponse>(message: TRequest): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const error = runtimeErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response);
    });
  });
}

export function sendMessageToTab<TRequest, TResponse>(tabId: number, message: TRequest): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: TResponse) => {
      const error = runtimeErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response);
    });
  });
}

export function executeScriptInTab(tabId: number, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files
      },
      () => {
        const error = runtimeErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      }
    );
  });
}

export function openOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.openOptionsPage(() => {
      const error = runtimeErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}
