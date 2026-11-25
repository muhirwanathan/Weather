'use strict';

/** Raised when user input fails validation (HTTP 400). */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/** Raised when a single upstream API call fails (timeout, 5xx, bad payload). */
class UpstreamError extends Error {
  constructor(message, { status = null, provider = 'upstream' } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.upstreamStatus = status;
    this.provider = provider;
  }
}

/** Raised when every configured provider failed and no cached copy exists (HTTP 503). */
class ServiceUnavailableError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.status = 503;
    this.details = details;
  }
}

module.exports = { ValidationError, UpstreamError, ServiceUnavailableError };
