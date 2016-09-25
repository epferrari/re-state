module.exports = {
  getter(o, p, fn){
    Object.defineProperty(o, p, {
      get: function(){
        return fn();
      },
      configurable: false
    });
    return o;
  },
  defineProperty(o, p, v){
    Object.defineProperty(o, p, {
      value: v,
      configurable: false,
      writable: false,
      enumerable: false
    });
    return o;
  },
  typeOf(subject){
    return ({}).toString.call(subject)
      .match(/\s([a-zA-Z]+)/)[1]
      .toLowerCase();
  }
};
