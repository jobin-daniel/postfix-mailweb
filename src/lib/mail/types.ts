export interface EmailAddress {
  name: string | null;
  address: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  partIndex: number;
}

export interface EmailHeader {
  name: string;
  value: string;
}

export interface ParsedEmail {
  messageId: string | null;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo: EmailAddress[];
  date: string | null;
  html: string | null;
  sanitizedHtml: string | null;
  text: string | null;
  headers: EmailHeader[];
  attachments: EmailAttachment[];
  rawSize: number;
}
