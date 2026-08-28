import { DomainError } from "./types.js";

export interface InvitationEmail {
  recipient: string;
  organisationName: string;
  invitationUrl: string;
  expiresAt: Date;
}

export interface CredentialExpiryEmail {
  recipient: string;
  tokenName: string;
  tokenPrefix: string;
  expiresAt: Date;
  reminderDays: number;
}

export interface TransactionalEmail {
  sendInvitation(message: InvitationEmail): Promise<void>;
  sendCredentialExpiry(message: CredentialExpiryEmail): Promise<void>;
}

export class HttpTransactionalEmail implements TransactionalEmail {
  constructor(private readonly endpoint: string, private readonly apiKey: string, private readonly sender: string) {}

  async sendInvitation(message: InvitationEmail): Promise<void> {
    await this.send(message.recipient,`Invitation to ${message.organisationName}`,`You were invited to ${message.organisationName}. Open ${message.invitationUrl} before ${message.expiresAt.toISOString()}.`);
  }

  async sendCredentialExpiry(message: CredentialExpiryEmail): Promise<void> {
    await this.send(message.recipient,`Credential expires in ${message.reminderDays} day${message.reminderDays===1?"":"s"}`,`The credential ${message.tokenName} (${message.tokenPrefix}) expires at ${message.expiresAt.toISOString()}. Rotate or revoke it before expiry.`);
  }

  private async send(recipient:string,subject:string,text:string):Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.sender,
        to: recipient,
        subject,
        text
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new DomainError("email_delivery_failed", `Transactional email provider returned HTTP ${response.status}.`, 502);
  }
}
