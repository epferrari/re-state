module.exports = function HookFactory(){
  return function Hook(transformer){
    return {
      $$transformer: transformer,
      $$factory: Hook
    };
  }
}
