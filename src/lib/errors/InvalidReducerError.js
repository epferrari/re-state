"use strict";

module.exports = class InvalidReducerError extends Error {
  constructor(){
    super()
    this.name = "InvalidReducer";
    this.message = "a reducer function must be passed as second argument to `<Container>.on` to handle an Action"
  }
}
