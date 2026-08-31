import type { CredentialExpiryEmail, InvitationEmail, TransactionalEmail } from "./email.js";
import type { ImmutablePackageStorage, PackageReviewScanner } from "./package_services.js";
import { DomainError } from "./types.js";

const unavailable = (feature: string): never => {
  throw new DomainError(
    "beta_feature_unavailable",
    `${feature} is not enabled for this beta deployment.`,
    503
  );
};

export class UnavailableTransactionalEmail implements TransactionalEmail {
  async sendInvitation(_message: InvitationEmail): Promise<void> {
    unavailable("Transactional email");
  }

  async sendCredentialExpiry(_message: CredentialExpiryEmail): Promise<void> {
    unavailable("Transactional email");
  }
}

export class UnavailablePackageStorage implements ImmutablePackageStorage {
  async createUpload(_objectKey: string, _size: number, _sha256: string): Promise<never> {
    return unavailable("Package storage");
  }

  async createDownload(_objectKey: string): Promise<never> {
    return unavailable("Package storage");
  }

  async inspect(_objectKey: string): Promise<never> {
    return unavailable("Package storage");
  }
}

export class UnavailablePackageScanner implements PackageReviewScanner {
  async scan(
    _objectKey: string,
    _expectedIntegrity: string,
    _publisherPublicId: string,
    _publisherKeyId: string
  ): Promise<never> {
    return unavailable("Package security scanning");
  }
}
