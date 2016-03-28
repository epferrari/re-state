module.exports = {
  getter: function(o, p, fn){
    Object.defineProperty(o, p, {
      get: function(){
        fn();
      },
      configurable: false
    });
  }
};
