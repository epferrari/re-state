module.exports = {
  getter: function(o, p, fn){
    Object.defineProperty(o, p, {
      get: function(){
        return fn();
      },
      configurable: false
    });
  }
};
