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
  groqApiKey: string;
  googleAppUrl: string;
  crmWebhookToken: string;
}

export type Language = 'IT' | 'EN';

export type MessageMode = 'template' | 'llm';
