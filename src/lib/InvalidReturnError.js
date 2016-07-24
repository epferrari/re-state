"use strict";

module.exports = class InvalidReturnError extends Error {
  constructor(){
    super();
    this.name = "InvalidReturn";
    this.message = "a reducer must return an object literal to reduce into state";
  }
}
