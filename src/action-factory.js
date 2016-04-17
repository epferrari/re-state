"use-strict";

const {getter, defineProperty} = require('./utils');
const {ACTION, ACTION_TRIGGERED} = require('./constants');

module.exports = function ActionFactory(EventEmitter){

  function Action(name, reducerFn){
    if(!reducerFn)
      reducerFn = name;

    const emitter = new EventEmitter();
    var callCount = 0;
    var undos = {}

    const functor = function functor(delta){
      callCount++;
      emitter.emit(ACTION_TRIGGERED, {token: callCount, delta: delta});

      // returns a function to undo the action's effect on a state
      return function(token){
        undos[token] && undos[token]();
        // uncache the undo fn
        undos[token] = null;
      }.bind(null, callCount);
    }

    // wrap the reducer function to apply undo logic
    const invoke = (lastState, deltaMap, undoFn, callToken) => {
      undos[callToken] = undoFn;
      return reducerFn(lastState, deltaMap);
    };

    const onAction = (handler) => {
      emitter.on(ACTION_TRIGGERED, handler);
      // return removal function
      return () => emitter.removeListener(ACTION_TRIGGERED, handler);
    };
    getter(functor, 'callCount', () => callCount);

    functor.$$name = name
    functor.$$invoke = invoke
    functor.$$type = ACTION
    functor.$$register = onAction


    return functor;
  }

  const strategies = {};
  defineProperty(strategies, 'COMPOUND', 'compound');
  defineProperty(strategies, 'HEAD', 'head');
  defineProperty(strategies, 'TAIL', 'tail');
  defineProperty(Action, 'strategies', strategies);

  return Action;
};
