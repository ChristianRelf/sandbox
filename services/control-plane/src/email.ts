import { DomainError } from "./types.js";

export interface InvitationEmail {
  recipient: string;
  organisationName: string;
  invitationUrl: string;
  expiresAt: Date;
}

export interface TransactionalEmail {
  sendInvitation(message: InvitationEmail): Promise<void>;
}

export class HttpTransactionalEmail implements TransactionalEmail {
  constructor(private readonly endpoint: string, private readonly apiKey: string, private readonly sender: string) {}

  async sendInvitation(message: InvitationEmail): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.sender,
        to: message.recipient,
        subject: `Invitation to ${message.organisationName}`,
        text: `You were invited to ${message.organisationName}. Open ${message.invitationUrl} before ${message.expiresAt.toISOString()}.`
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new DomainError("email_delivery_failed", `Invitation email provider returned HTTP ${response.status}.`, 502);
  }
}
