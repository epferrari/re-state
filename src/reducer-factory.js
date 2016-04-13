"use-strict";

const {getter, defineProperty} = require('./utils');
const {REDUCER, HOOK} = require('./constants');

module.exports = function ReducerFactory(EventEmitter){

  const REDUCE_EVENT = 'REDUCER_INVOKED';

  function Reducer(name, transformer){
    if(!transformer)
      transformer = name;

    const emitter = new EventEmitter();
    var callCount = 0;
    var undos = {}

    const functor = function functor(deltaMap){
      callCount++;
      emitter.emit(REDUCE_EVENT, {token: callCount, deltaMap: deltaMap});

      // returns a function to undo the action's effect on a state
      return function(token){
        undos[token] && undos[token]();
        // uncache the undo fn
        undos[token] = null;
      }.bind(null, callCount);
    }

    const wrappedTransformer = (lastState, deltaMap, undoFn, callToken) => {
      undos[callToken] = undoFn;
      return transformer(lastState, deltaMap);
    };

    const register = (callback) => {emitter.on(REDUCE_EVENT, callback)};

    defineProperty(functor, 'action', name);
    defineProperty(functor, 'invoke', wrappedTransformer);
    defineProperty(functor, 'type', REDUCER);
    defineProperty(functor, 'addListener', register );
    getter(functor, 'callCount', () => callCount)

    return functor;
  }

  const strategies = {};
  defineProperty(strategies, 'COMPOUND', 'compound');
  defineProperty(strategies, 'HEAD', 'head');
  defineProperty(strategies, 'TAIL', 'tail');
  getter(Reducer, 'strategies', () => strategies);

  return Reducer;
};
