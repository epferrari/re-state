"use strict";

const keyMirror = (arr) => arr
  .reduce((acc, val) => {
    acc[val] = val;
    return acc;
  }, {});

module.exports = keyMirror([
  // action types
  "ACTION",
  "ASYNC_ACTION",

  // store phases
  "READY",
  "QUEUED",
  "REDUCING",

  // reducer operations
  "RESOLVE",
  "CANCEL",
  "UNDO",
  "REDO",

  // action events
  "ACTION_TRIGGERED",
  "UNDO_ACTION",
  "REDO_ACTION",
  "CANCEL_ACTION",

  // store events
  "STATE_CHANGE",
  "SET_STATE_INVOKED",
  "REDUCE_INVOKED",
]);
