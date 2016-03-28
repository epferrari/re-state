"use strict";

module.exports = {
  getter: function getter(o, p, fn) {
    Object.defineProperty(o, p, {
      get: function get() {
        fn();
      },
      configurable: false
    });
  }
};