"use-strict";

const ReducerFactory = require('./reducer-factory');
const HookFactory = require('./hook-factory');
const getter = require('./utils').getter;

module.exports = function StateStoreFactory(Immutable, EventEmitter, _){

  const Reducer = ReducerFactory(EventEmitter)
  const Hook = HookFactory()

  // events
  const CHANGE_EVENT = 'STATE_CHANGE';
  const SET_EVENT = 'SET_INVOKED';
  const REDUCE_EVENT = 'REDUCE_INVOKED';
  const REDUCER_ADDED = "REDUCER_ADDED";

  const errors = {
    INVALID_DELTA: "a delta passed to reducer as new state must be an object literal",
    INVALID_RETURN: "a reducer must return an object literal to reduce into state",
    INVALID_REDUCER: "a reducer must be created by either the Reducer or Hook factory"
  }

  function StateStore(initialState){

    var history, historyIndex, emitter, reducers, pendingSetOperations, executeReduceCycle, queueReduceCycle;

    // history: private stack of Immutable Map app states
    // never manipulate history stack directly
    history = [ Immutable.Map(initialState) ];
    // pointer to current state of history
    historyIndex = 0;

    getter(this,'state', () => (Immutable.Map(history[historyIndex]).toJS()) );

    emitter = new EventEmitter();
    getter(this, 'emitter', () => {return emitter} );

    // list of reducer to apply to change state
    reducers = [];
    // any deltas created by calls to setState during the callstack go here
    pendingSetOperations = [];


    /**
    *
    * @desc reduce a possible new state from pending updates
    * @private
    */
    executeReduceCycle = function executeReduceCycle(currentImmutableState){
      this.emitter.emit(REDUCE_EVENT)

      let relevantReducers = StateStore.getRelevantReducers(reducers)

      let maybeNewState = relevantReducers.reduce((lastImmutableState, reducer) => {
        let newState;

        if(reducer.type === Reducer){
          let delta = reducer.delta;

          if(!delta || Immutable.is(delta, reducer.lastDelta)){
            // skip the reducer, action wasn't called with a delta
            reducer.delta = undefined
            return lastImmutableState;
          }else if(reducer.delta && _.isPlainObject(reducer.delta)){
            // action was called with a delta, transform state with the reducer and delta
            newState = reducer.transform(lastImmutableState.toJS(), reducer.delta);
            // clear the reducer of its delta state
            reducer.lastDelta = delta;
            reducer.delta = undefined;
          }else{
            reducer.delta = undefined;
            throw new Error(errors.INVALID_DELTA);
          }
        }else if(reducer.type === Hook){
          // just apply the hook to transform state
          newState = reducer.transform(lastImmutableState.toJS())
        }

        if( !_.isPlainObject(newState) )
          throw new Error(errors.INVALID_RETURN);

        // Immutable merge so the next reducer gets full state
        return lastImmutableState.merge(newState);
      }, currentImmutableState );

      // clear the deck of pending set operations
      pendingSetOperations = [];

      // notify on change
      if( !Immutable.is(this.getImmutableState(), maybeNewState)){
        history = history.slice(0,historyIndex + 1);
        history.push(maybeNewState);
        historyIndex++;
        this.trigger()
      }
    }.bind(this);


    /**
    *
    * @desc queue a reduce cycle on next tick
    * @private
    */
    queueReduceCycle = function queueReduceCycle(index, newState){
      reducer = reducers[index];
      reducer.delta = newState;
      // determine how many deltas are queued
      pendingDeltas = _.filter(reducers, reducer => {
        reducer.delta !== undefined;
      });
      // defer a state reduction on the next tick if one isn't already queued
      if(pendingDeltas.length === 1)
        setTimeout(() => executeReduceCycle(this.getImmutableState()), 0);
    }.bind(this);

    /**
    *
    * @name addReducer
    * @param {function} reducer - create with `new redstate.Reducer()`
    * @desc execute a reduce cycle when this function is called with a delta state
    */
    this.addReducer = function addReducer(reducer){
      if(reducer.$$factory !== Reducer && reducer.$$factory !== Hook)
        throw new TypeError(errors.INVALID_REDUCER)

      if(!_.contains(reducers, reducer))
        reducers.push({
          transform: reducer.$$transformer,
          type: reducer.$$factory
        });

      let reducerIndex = (reducers.length - 1);

      // kick off a reduce cycle when the reducer action is called anywhere in the app
      reducer.$$bind((newState) => queueReduce(reducerIndex, newState));
      this.emitter.emit(REDUCER_ADDED, reducer);
    }.bind(this);

    // set the store's first reducer to handle direct setState operations
    let stateSetter = new Reducer( (lastState, delta) => _.merge.apply(_, [{}].concat(delta.pendingSetOps)) );
    this.addReducer(stateSetter);

    /**
    *
    * @name setState
    * @desc Reduce an updated state on the next tick with a plain object. Emits `SET_STATE` event
    * @param {object} a state delta to be reduced against and eventually merged into state
    * @instance
    * @memberof StateStore
    */
    this.setState = function setState(newState){
      this.emitter.emit(SET_EVENT, newState)
      pendingSetOperations.push(newState)
      stateSetter({pendingSetOps: pendingSetOperations});
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
      this.emitter.on(CHANGE_EVENT, callback, thisBinding);
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
  * @desc inspect deltas to find the index of the earliest reducer that should be called
  *   during the reduce cycle
  * @static
  */
  StateStore.getRelevantReducers = function(reducersArray){
    index = _.reduce(reducersArray, (res, reducer, i) => {
      if(reducer.delta !== undefined)
        res.push(i);
      return res;
    },[])
    .sort((a, b) => (a - b))
    [0]

    // get all reducers from index to end of list
    return reducersArray.slice(index)
  }


  // return constructor
  return StateStore;

};
