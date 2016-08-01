"use strict";

const keyMirror = (arr) => {
  return arr.reduce((acc, val) => {
    acc[val] = val;
    return acc;
  }, {});
};

module.exports = keyMirror([
  // action types
  "ACTION",
  "ASYNC_ACTION",

  // store phases
  "DORMANT",
  "QUEUED",
  "REDUCING",

  // action events
  "ACTION_TRIGGERED",
  "UNDO_ACTION",
  "REDO_ACTION",

  // store events
  "STATE_CHANGE",
  "SET_STATE_INVOKED",
  "REDUCE_INVOKED",
  "ACTION_ADDED"
]);
