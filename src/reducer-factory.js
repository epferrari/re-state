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

    const functor = function functor(){
      callCount++;
      emitter.emit(REDUCE_EVENT, arguments[0]);
      return function(cc){
        undos[cc]()
      }.bind(null, callCount);
    }

    const wrappedTransformer = (undoFn, lastState, deltaMap) => {
      undos[callCount] = undoFn;
      return transformer(lastState, deltaMap);
    };

    const register = (callback) => {emitter.on(REDUCE_EVENT, callback)};

    defineProperty(functor, 'name', name);
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
