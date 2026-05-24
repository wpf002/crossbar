export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class InsufficientFundsError extends EngineError {
  constructor(message = 'Insufficient wallet balance for this order') {
    super('INSUFFICIENT_FUNDS', message);
  }
}

export class InsufficientPositionError extends EngineError {
  constructor(message = 'Insufficient shares to sell') {
    super('INSUFFICIENT_POSITION', message);
  }
}

export class MarketNotOpenError extends EngineError {
  constructor(message = 'Market is not open for trading') {
    super('MARKET_NOT_OPEN', message);
  }
}

export class InvalidPriceError extends EngineError {
  constructor(message = 'Price must be an integer between 1 and 99') {
    super('INVALID_PRICE', message);
  }
}

export class InvalidOrderError extends EngineError {
  constructor(message = 'Order failed validation') {
    super('INVALID_ORDER', message);
  }
}

export class OrderNotFoundError extends EngineError {
  constructor(orderId: string) {
    super('ORDER_NOT_FOUND', `Order ${orderId} not found`);
  }
}

export class SelfTradeError extends EngineError {
  constructor(message = 'Cannot trade against your own resting order') {
    super('SELF_TRADE', message);
  }
}
