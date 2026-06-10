export class SendAnnouncementDto {
  subject!: string;
  title!: string;
  bodyHtml!: string;
  recipientType!: 'ALL_ACTIVE' | 'DIGEST_ENABLED';
  theme?: 'blue' | 'amber' | 'rose';
  ctaLabel?: string;
  ctaUrl?: string;
  /** Key-value pairs to replace {{placeholder}} in subject, title, bodyHtml */
  templateValues?: Record<string, string>;
}
