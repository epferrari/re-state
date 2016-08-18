"use strict";

module.exports = class InvalidActionError extends Error {
  constructor(){
    super()
    this.name = "InvalidAction";
    this.message = "an action must be created by calling `new Action(<action_name>)`"
  }
}
