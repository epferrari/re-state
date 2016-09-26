'use strict';

var utils = {
  getter: function getter(o, p, fn) {
    Object.defineProperty(o, p, {
      get: function get() {
        return fn();
      },
      configurable: false
    });
    return o;
  },
  defineProperty: function defineProperty(o, p, v) {
    Object.defineProperty(o, p, {
      value: v,
      configurable: false,
      writable: false,
      enumerable: false
    });
    return o;
  },
  typeOf: function typeOf(subject) {
    return {}.toString.call(subject).match(/\s([a-zA-Z]+)/)[1].toLowerCase();
  },
  isPlainObject: function isPlainObject(subject) {
    return utils.typeOf(subject) === 'object';
  },
  isArray: function isArray(subject) {
    return utils.typeOf(subject) === 'array';
  },
  isFunction: function isFunction(subject) {
    return utils.typeOf(subject) === 'function';
  }
};

module.exports = utils;