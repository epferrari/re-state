"use-strict";

const ReducerFactory = require('./reducer-factory');
const HookFactory = require('./hook-factory');
const {getter, defineProperty} = require('./utils');
const {REDUCER, HOOK} = require('./constants');

module.exports = function StateStoreFactory(Immutable, EventEmitter, _){

  const Reducer = ReducerFactory(EventEmitter)
  const Hook = HookFactory()

  // events
  const CHANGE_EVENT = 'STATE_CHANGE';
  const SET_EVENT = 'SET_INVOKED';
  const REDUCE_EVENT = 'REDUCE_INVOKED';
  const REDUCER_ADDED = "REDUCER_ADDED";

  function StateStore(initialState){
    var history,
        historyIndex,
        emitter,
        reducerList,
        addStateToHistory,
        resolveDelta,
        resolveReducer,
        queueReduceCycle,
        executeReduceCycle;

    if(typeof initialState !== 'undefined' && !_.isPlainObject(initialState))
      throw new Error(StateStore.errors.INVALID_DELTA);

    // history: private stack of Immutable Map app states
    // never manipulate history stack directly
    history = [ Immutable.Map(initialState) ];
    // pointer to current state of history
    historyIndex = 0;

    emitter = new EventEmitter();
    // list of reducer to apply to change state
    reducerList = Immutable.List();

    getter(this, 'emitter', () => emitter );
    getter(this,'state', () => Immutable.Map(history[historyIndex]).toJS() );
    getter(this, 'reducers', () => reducerList.toJS() );

    /**
    * @desc remove any states from index onward
    * @private
    * @return historyIndex
    */
    addStateToHistory = function addStateToHistory(newState){
      if(!Immutable.is(this.getImmutableState(), newState)){
        history = history.slice(0, historyIndex + 1);
        history.push(newState);
        historyIndex++;
      }
      return historyIndex;
    }.bind(this);

    resolveDelta = function resolveDelta(lastState, deltaMap, reducerFn){
      if(deltaMap && _.isPlainObject(deltaMap)){
        // create an undo function to reset the state to the index before applying the reducer
        let undoFn = () => {
          history = history.slice(0, historyIndex + 1);
          this.trigger();
        };

        let resolvedState = reducerFn(undoFn, lastState, deltaMap);

        if( !_.isPlainObject(resolvedState) )
          throw new Error(StateStore.errors.INVALID_RETURN);
        else
          // add a new state to the history and increment index
          addStateToHistory(resolvedState);
          // return state to the next reducer
          return resolvedState;
      }else{
        throw new Error(StateStore.errors.INVALID_DELTA);
      }
    }.bind(this)

    resolveReducer = function resolveReducer(lastState, reducer){
      let deltaMap;
      let reducerFn = reducer.$invoke;

      switch(reducer.strategy){
        case (Reducer.strategies.COMPOUND):
          // reduce down all the deltas
          return _.reduce(reducer.deltaMaps, (state, deltaMap) => {
            return resolveDelta(state, deltaMap, reducerFn);
          }, lastState);
        case (Reducer.strategies.HEAD):
          // transform using the first delta queued
          deltaMap = reducer.deltaMaps[0];
          return resolveDelta(lastState, deltaMap, reducerFn);
        case (Reducer.strategies.TAIL):
          // resolve using the last delta queued
          deltaMap = reducer.deltaMaps[(reducer.deltaMaps.length - 1)];
          return resolveDelta(lastState, deltaMap, reducerFn);
        default:
          // use tailing strategy
          let deltaMap = reducer.deltaMaps[(reducer.deltaMaps.length - 1)];
          return resolveDelta(lastState, deltaMap, reducerFn);
      }
    }


    /**
    *
    * @desc reduce a series of new states from pending reducers
    * @private
    */
    executeReduceCycle = function executeReduceCycle(previousImmutableState){
      this.emitter.emit(REDUCE_EVENT)
      let relevantReducers = StateStore.getRelevantReducers(this.reducers);
      let maybeNewState = _.reduce(relevantReducers, (state, reducer) => {
        let newState;

        if(reducer.type === REDUCER){
          // run the state through the reducer
          newState = resolveReducer(state.toJS(), reducer);
        }else if(reducer.type === HOOK){
          // just apply the hook to transform state
          newState = reducer.$invoke(state.toJS())
        }
        // clear deltaMaps for the next cycle and create new immutable list
        reducerList = reducerList.update(reducer.index, (reducer) => {
          reducer.deltaMaps = [];
          return reducer;
        });

        // Immutable merge so the next reducer gets full state
        return state.merge(newState);
      }, previousImmutableState );

      // notify on change
      if( !Immutable.is(previousImmutableState, maybeNewState)){
        this.trigger()
      }
    }.bind(this);



    let reducePending = false;
    /**
    *
    * @desc queue a reduce cycle on next tick
    * @private
    */
    queueReduceCycle = function queueReduceCycle(index, deltaMap){
      // update reducer hash in reducerList with deltaMap
      reducerList = reducerList.update(index, reducer => {
        reducer.deltaMaps.push(deltaMap);
        return reducer;
      });

      // defer a state reduction on the next tick if one isn't already queued
      if(!reducePending){
        reducePending = true;
        setTimeout(() => {
          reducePending = false;
          executeReduceCycle(this.getImmutableState());
        }, 0);
      }
    }.bind(this);

    /**
    *
    * @name listenTo
    * @param {function} reducer - create with `new Restate.Reducer()`
    * @param {string} strategy - one of ['compound', 'lead', 'tail']
    * @desc execute a reduce cycle when this function is called with a deltaMap
    */
    this.listenTo = function listenTo(reducer, strategy){
      if((reducer.type == REDUCER) || (reducer.type == HOOK)){
        let index = reducerList.size;

        // only add a Reducer once; a Hook can be added multiple times
        if((reducer.type === HOOK) || !_.contains(reducerList.toJS(), reducer)){
          reducerList = reducerList.push({
            $invoke: (undoFn, lastState, deltaMap) => {
              /* maybe middleware here later */
              return reducer.invoke(undoFn, lastState, deltaMap);
            },
            index: index,
            strategy: strategy,
            deltaMaps: [],
            type: reducer.type
          });


          // kick off a reduce cycle when the reducer action is called anywhere in the app
          let removeListener = reducer.addListener((deltaMap) => queueReduceCycle(index, deltaMap));
          // create a deregistration function to effectively remove the reducer from the reducerList
          let removeReducer = () => {
            removeListener();
            reducerList = reducerList.update(index, (reducer) => {
              return {
                $invoke: lastState => lastState,
                type: Hook
              }
            });
          }

          this.emitter.emit(REDUCER_ADDED, reducer);

          // return deregistration function
          return removeReducer;
        }
      } else {
        throw new Error(StateStore.errors.INVALID_REDUCER);
      }
    }.bind(this);

    // set the store's first reducer to handle direct setState operations
    let stateSetter = new Reducer('setState', (lastState, deltaMap) => _.merge({}, lastState, deltaMap));
    this.listenTo(stateSetter, Reducer.strategies.COMPOUND);

    /**
    *
    * @name setState
    * @desc Reduce an updated state on the next tick with a plain object. Emits `SET_STATE` event
    * @param {object} deltaMap - a state deltaMap to be reduced against and eventually merged into state
    * @instance
    * @memberof StateStore
    */
    this.setState = function setState(deltaMap){
      stateSetter(deltaMap);
    };


    /**
    *
    * @name getImmutableState
    * @desc Get the current state as an Immutable Map
    * @instance
    * @memberof StateStore
    * @returns Immutable.Map
    */
    this.getImmutableState = function getImmutableState(){
      return Immutable.Map( history[historyIndex]);
    };


    /**
    *
    * @name getInitialState
    * @desc Get the initial app state that was passed to the constructor
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.getInitialState = function getInitialState(){
      return history[0].toJS();
    };


    /**
    *
    * @name getStateAtVersion
    * @desc Get the app's state at a version in the state history
    * @param {int} index
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.getStateAtVersion = function getStateAtVersion(index){
      if(history[index])
        return history[index].toJS();
    };


    /**
    *
    * @name reset
    * @desc Reset the app to it's original state. Triggers a change event
    * @param {boolean} force - delete state history
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.reset = function reset(force){
      var _initialState = this.getInitialState();
      if(force === true){
        // hard reset, clears the entire history stack, no previous histories are saved
        history = [Immutable.Map(_initialState)];
        historyIndex = 0;
      }else{
        // soft reset, push the initial state to the end of the history stack
        history.push(Immutable.Map(_initialState));
        historyIndex++;
      }

      this.trigger()

      return this.state;
    };


    /**
    *
    * @name rewind
    * @desc rewind the app history n versions. If `n` is greater than length of
    *   history stack, history will rewind to initial state. If `n` is less than
    *   zero, no rewind will occur. Triggers a change event.
    * @param {int} n - number of versions back to go
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.rewind = function rewind(n){
      if(n < 0) n = 0;
      var target = historyIndex - n;
      if(target > 0){
        historyIndex = target;
        this.trigger()
      }

      return this.state;
    };

    /**
    *
    * @name canUndo
    * @desc can an undo operation be performed on the state?
    * @instance
    * @memberof StateStore
    * @returns {boolean}
    */
    Object.defineProperty(this,'canUndo', function canUndo(){
      return (historyIndex > 0);
    });


    /**
    *
    * @name canRedo
    * @desc can a redo operation be performed on the state?
    * @instance
    * @memberof StateStore
    * @returns {boolean}
    */
    getter(this,'canRedo', function canRedo(){
      return historyIndex !== (history.length - 1);
    });

    /**
    *
    * @name undo
    * @desc If possible, move the history stack's HEAD back one version.
    *   Triggers a change event.
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.undo = function undo(){
      if(this.canUndo){
        historyIndex = historyIndex - 1;
        this.trigger()
      }
      return this.state;
    };

    /**
    *
    * @name redo
    * @desc If possible, move the history stack's HEAD ahead one version.
    *   Triggers a change event.
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    this.redo = function redo(){
      if(this.canRedo){
        historyIndex++;
        this.trigger()
      }
      return this.state;
    };

    this.getIndex = function getIndex(){
      return historyIndex;
    };
  }


  StateStore.prototype = {
    /**
    *
    * @name addListener
    * @desc add listener for changes to the store state
    * @returns an unlisten function for the listener
    * @instance
    * @memberof StateStore
    */
    addListener(callback, thisBinding){
      // immediately invoke the callback with current state (desired?)
      callback(this.state);
      return this.emitter.on(CHANGE_EVENT, callback, thisBinding);
    },

    /**
    * @name trigger
    * @desc alert all listeners with the current state
    * @instance
    * @memberof StateStore
    */
    trigger(){
      this.emitter.emit(CHANGE_EVENT, this.state);
    }
  }



  /* ------- Static Methods ----------- */

  /**
  *
  * @desc inspect deltaMaps to find the index of the earliest reducer that should be called
  *   during the reduce cycle
  * @static
  */
  StateStore.getRelevantReducers = function getRelevantReducers(reducersArray){
    let index = _.reduce(reducersArray, (res, reducer, idx) => {
      if(reducer.deltaMaps.length > 0)
        res.push(idx);
      return res;
    },[])
    .sort((a, b) => (a - b))
    [0]

    // get all reducers from index to end of list
    return reducersArray.slice(index)
  };

  const errors = {};
  getter( errors, 'INVALID_DELTA', () => "a deltaMap passed to reducer as new state must be an object literal" );
  getter( errors, 'INVALID_RETURN', () => "a reducer must return an object literal to reduce into state" );
  getter( errors, 'INVALID_REDUCER' , () => "a reducer must be created by either the Reducer or Hook factory");
  getter(StateStore, 'errors', () => errors );

  // return constructor
  return StateStore;

};
