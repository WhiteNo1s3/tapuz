'use strict';

class BentmlError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ line?: number, column?: number, fix?: string }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'BentmlError';
    this.code = code;
    this.line = extra.line;
    this.column = extra.column;
    this.fix = extra.fix;
  }

  toString() {
    let s = `${this.code}: ${this.message}`;
    if (this.line != null) s += ` (line ${this.line}${this.column != null ? ':' + this.column : ''})`;
    if (this.fix) s += `\nFix: ${this.fix}`;
    return s;
  }
}

module.exports = { BentmlError };
