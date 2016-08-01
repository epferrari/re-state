"use strict";

module.exports = class InvalidIndexError extends Error {
  constructor(){
    super();
    this.name = "InvalidHistoryIndex";
    this.message = "history index must be an integer";
  }
}
