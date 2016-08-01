"use strict";

module.exports = class InvalidDeltaError extends Error {
  constructor(){
    super();
    this.name = "InvalidDelta";
    this.message = "a deltaMap passed to merge into state must be an object literal";
    this.stack = (new Error()).stack;
  }
}
