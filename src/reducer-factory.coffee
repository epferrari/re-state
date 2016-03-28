module.exports = function ReducerFactory(EventEmitter){

  REDUCE_EVENT = 'REDUCER_INVOKED';

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

  return Reducer;
};
