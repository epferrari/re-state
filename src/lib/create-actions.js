"use strict";

const Action = require("./action")

module.exports = function createActions(actionNames){
  return actionNames.reduce((acc, name) => {
    acc[name] = new Action(name);
    return acc;
  }, {});
};
