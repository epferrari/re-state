"use strict";

module.exports = class CircularInvocationError extends Error {
  constructor(){
    super();
    this.name = "CircularInvocation";
    this.message = "an action cannot be invoked in a reducer or in middleware";
    this.stack = (new Error()).stack;
  }
}
