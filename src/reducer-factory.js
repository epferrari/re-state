"use-strict";

const getter = require('./utils').getter;

module.exports = function ReducerFactory(EventEmitter){

  const REDUCE_EVENT = 'REDUCER_INVOKED';

  function Reducer(transformer){
    const emitter = new EventEmitter();

    const functor = function functor(){
      emitter.emit(REDUCE_EVENT, arguments[0]);
      [REDUCE_EVENT, arguments[0]];
    }

    functor.$$transformer = transformer;
    functor.$$factory = Reducer;
    functor.$$bind = (callback) => {emitter.on(REDUCE_EVENT, callback)};

    return functor;
  }

  const strategies = {};
  getter(strategies, 'COMPOUND', () => 'compound');
  getter(strategies, 'HEAD', () => 'head');
  getter(strategies, 'TAIL', () => 'tail');
  getter(Reducer, 'strategies', () => strategies);

  return Reducer;
};
