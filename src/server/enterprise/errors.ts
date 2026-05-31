export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EnterpriseAdapterError extends BindingError {}
export class EnterpriseDisabledError extends BindingError {}
export class EnterpriseIdentityNotFoundError extends BindingError {}
export class EnterpriseIdentityConflictError extends BindingError {}
export class EnterpriseDeprovisionedError extends BindingError {}

