"use strict";

var Action = require("./action");

module.exports = function createActions(actionNames) {
  return actionNames.reduce(function (acc, name) {
    acc[name] = new Action(name);
    return acc;
  }, {});
};