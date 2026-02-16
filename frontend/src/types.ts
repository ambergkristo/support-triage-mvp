export type EmailMessage = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
};

export type TriageResult = {
  category?: string;
  priority?: string;
  summary?: string;
  suggestedResponse?: string;
  [key: string]: unknown;
};
