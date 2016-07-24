"use strict";

module.exports = class InvalidReducerError extends Error {
  constructor(){
    super()
    this.name = "InvalidReducer";
    this.message = "a reducer must be created by the Action factory with `new Restate.Action(<reducer>)`"
  }
}
