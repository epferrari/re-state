"use-strict";

const {getter, defineProperty} = require('./utils');
const {HOOK, HOOK_TRIGGERED} = require('./constants');

module.exports = function ReducerFactory(){
  return function Hook(name, reducerFn){
    if(!(this instanceof Hook))
      return new Hook(name, reducerFn)

    this.$$name = name;
    if(!reducerFn){
      reducerFn = name;
      this.$$name = "";
    }
    this.$$invoke = reducerFn;
    this.$$type = HOOK;
  }
};
