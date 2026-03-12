export interface ProfileData {
  name: string;
  fullName: string;
  headline: string;
  company: string;
  location: string;
  url: string;
  isItalian: boolean;
}

export interface ExtensionSettings {
  integrationMode?: 'dashboard' | 'legacy';
  dashboardBaseUrl?: string;
  pluginToken?: string;
  campaignId?: string;
  groqApiKey: string;
  googleAppUrl: string;
  crmWebhookToken: string;
}

export type Language = 'IT' | 'EN';

export type MessageMode = 'template' | 'llm';
