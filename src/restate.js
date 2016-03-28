
module.exports = function(Immutable, EventEmitter, _){
  return {
    Store: require('./store-factory')(Immutable, EventEmitter, _),
    Reducer: require('./reducer-factory')(EventEmitter),
    Hook: require('./hook-factory')
  };
};
