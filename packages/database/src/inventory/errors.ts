export class InventoryDomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InsufficientInventoryError extends InventoryDomainError {
  public constructor(details: Readonly<Record<string, unknown>>) {
    super('INSUFFICIENT_INVENTORY', 'One or more inventory lines are insufficient.', details);
  }
}

export class IdempotencyConflictError extends InventoryDomainError {
  public constructor(key: string) {
    super('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with different input.', { key });
  }
}

export class InvalidInventoryCommandError extends InventoryDomainError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super('INVALID_INVENTORY_COMMAND', message, details);
  }
}

export class ReservationStateError extends InventoryDomainError {
  public constructor(batchId: string) {
    super('RESERVATION_STATE_CONFLICT', 'The reservation batch is not active.', { batchId });
  }
}
