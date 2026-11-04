/**
 * Lets any part of ShifuBot report its own events (a member failed the captcha, someone changed a
 * setting on the dashboard) to the audit log feature without importing it. Until the audit log
 * feature attaches itself, records are dropped.
 */
export type AuditTargetKind = 'user' | 'channel' | 'role' | 'message' | 'invite' | 'emoji' | 'sticker' | 'event' | 'rule' | 'webhook' | 'integration' | 'guild' | 'feature' | 'other';

export interface AuditRecord {
  /** Event type id, e.g. "shifubot.settings" or "member.join". */
  type: string;
  /** Who did it. */
  actorId?: string | null;
  /** Who or what it happened to. */
  targetId?: string | null;
  targetKind?: AuditTargetKind | null;
  /** Channel it happened in (messages, voice, reactions). Used for the visibility filter. */
  channelId?: string | null;
  /** Free form details shown in the expanded row. Must be JSON serialisable. */
  data?: Record<string, unknown>;
  /** Event time in ms, defaults to now. */
  at?: number;
}

export type AuditHandler = (guildId: string, record: AuditRecord) => void;

export class AuditSink {
  private handler: AuditHandler | null = null;

  /** Called once by the audit log feature. */
  attach(handler: AuditHandler): void {
    this.handler = handler;
  }

  record(guildId: string, record: AuditRecord): void {
    try {
      this.handler?.(guildId, record);
    } catch {
      // Logging must never break the feature that reports.
    }
  }
}
