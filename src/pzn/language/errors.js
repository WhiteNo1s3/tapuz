'use strict';

class BentError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ path?: string, line?: number, column?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'BentError';
    this.code = code;
    this.path = extra.path;
    this.line = extra.line;
    this.column = extra.column;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      line: this.line,
      column: this.column
    };
  }
}

module.exports = { BentError };
