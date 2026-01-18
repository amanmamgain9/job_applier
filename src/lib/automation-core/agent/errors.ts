/**
 * Agent error types
 */

export class ChatModelAuthError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelAuthError';
  }
}

export class ChatModelForbiddenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelForbiddenError';
  }
}

export class ChatModelBadRequestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelBadRequestError';
  }
}

export class RequestCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

export class MaxStepsReachedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MaxStepsReachedError';
  }
}

export class MaxFailuresReachedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MaxFailuresReachedError';
  }
}

export class ResponseParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ResponseParseError';
  }
}

export function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const errorMessage = error.message || '';
  let errorName = error.name || '';

  const constructorName = error.constructor?.name;
  if (constructorName && constructorName !== 'Error') {
    errorName = constructorName;
  }

  if (errorName === 'AuthenticationError') {
    return true;
  }

  return (
    errorMessage.toLowerCase().includes('authentication') ||
    errorMessage.includes(' 401') ||
    errorMessage.toLowerCase().includes('api key')
  );
}

export function isForbiddenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(' 403') && error.message.includes('Forbidden');
}

export function isBadRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errorMessage = error.message || '';
  return (
    errorMessage.includes(' 400') ||
    errorMessage.toLowerCase().includes('badrequest') ||
    errorMessage.includes('Invalid parameter')
  );
}

export function isAbortedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.message.includes('Aborted');
}

