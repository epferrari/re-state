"use-strict";

const Action = require('./Action');
const {getter, defineProperty} = require('./utils');
const {ACTION, ASYNC_ACTION, CHANGE_EVENT, SET_EVENT, REDUCE_EVENT, ACTION_ADDED} = require('./constants');
const EventEmitter = require('./EventEmitter');
const InvalidDeltaError = require('./InvalidDeltaError');
const InvalidReturnError = require('./InvalidReturnError');
const InvalidReducerError = require('./InvalidReducerError');
const InvalidIndexError = require('./InvalidIndexError');


module.exports = function StoreFactory(Immutable, _, generateGuid){

  let {isPlainObject, isFunction, isArray, merge, reduce, chain, contains} = _;

  return class StateStore {
    /**
    * @constructs StateStore
    * @param {object} initialState={} - an initial state for your store
    * @param {array} [middleware=[]] - an array of middleware functions to apply during state transitions
    */
    constructor(initialState, middleware){

      var $$history,
          $$index,
          $$reducers,
          $$middleware,
          emitter,
          trigger,
          currentState,
          reducePending = false,
          pendingRevisions = [];



      if(typeof initialState !== 'undefined' && !isPlainObject(initialState))
        throw new InvalidDeltaError();

      // pointer to current state of $$history
      $$index = 0;

      // list of reducers invoked to change state
      $$reducers = Immutable.List();

      // private stack of [reducer index, Immutable Map app state]
      $$history = [{
        reducer_invoked: 0,
        payload: {},
        $state: Immutable.Map().merge(initialState),
        guid: generateGuid()
      }];


      $$middleware = _.isArray(middleware) ? middleware : [];

      emitter = new EventEmitter();

      currentState = () => {
        let state = Immutable.Map($$history[$$index].$state).toJS();
        return reduce(state, (acc, val, key) => {
          if(val !== undefined)
            acc[key] = val;
          return acc;
        }, {});
      };


      getter(this, 'reducers', () => $$reducers.toJS() );
      getter(this, 'previousStates', () => $$history.length);
      getter(this, 'history', () => $$history);
      getter(this, 'index', () => $$index);
      getter(this, 'state', () => currentState());
      getter(this, '_emitter', () => emitter );




      trigger = () => this.trigger();





      // respect "$unset" value passed to remove a value from state
      function merger(prev, next, key){
        if(next == "$unset")
          return undefined;
        else if(next === undefined)
          return prev;
        else
          return next;
      };

      /**
      *
      * @desc queue a reduce cycle on next tick
      * @private
      */
      function queueReduceCycle(index, token, payload){
        if(arguments.length){
          // update reducer hash in $$reducers with action's payload
          $$reducers = $$reducers.update(index, reducer => {
            reducer.requests.push({payload: payload, token: token});
            return reducer;
          });
        }

        // defer a state reduction on the next tick if one isn't already queued
        if(!reducePending || pendingRevisions.length){
          reducePending = true;
          setTimeout(() => {
            // TODO: ensure no actions are collected during a reduce cycle, aka actions within actions

            // reduce over any queued actions and undo/redo revisions and
            // determine whether to push a state change
            let shouldTrigger = executeReduceCycle(currentState());

            if(pendingRevisions.length){
              shouldTrigger = true;
              pendingRevisions.forEach(reviseHistory);
              pendingRevisions = [];
            }

            if(shouldTrigger) trigger();

          }, 0);
        }
      };


			/**
      * @name executeReduceCycle
      *
      * @desc resolve a series of new states from pending $$reducers
      * @private
      */
      function executeReduceCycle(previousState){
        emitter.emit(REDUCE_EVENT);
        let initialIndex = $$index;
        let reducersToCall = chain($$reducers.toJS())
          .filter(reducer => reducer.requests.length)
          .sortBy(reducer => reducer.index)
          .value()

        reduce(reducersToCall, (state, reducer) => {
          // run the state through the reducer
          let nextState = resolveReducer(state, reducer);
          // clear action requests for the next cycle and create new immutable list
          $$reducers = $$reducers.update(reducer.index, r => {
            r.requests = [];
            return r;
          });
          return nextState;
        }, merge({}, previousState) );

        // reset for next reduce cycle
        reducePending = false;

        // was history updated?
        return (initialIndex !== $$index);
      }


      /**
      * @name resolveReducer
      *
      * @desc resolve an action's invocation against the last state according
      *   to the strategy defined for the action
      * @returns the updated state
      */
			function resolveReducer(lastState, reducer){
        let req;

        switch((reducer.strategy || "").toLowerCase()){
          case (Action.strategies.COMPOUND.toLowerCase()):
            // reduce down all the requested invocations
            return reduce(reducer.requests, (state, r) => {
              return resolveDelta(state, r.payload, reducer, r.token);
            }, lastState);
          case (Action.strategies.HEAD.toLowerCase()):
            // transform using the first requested invocation queued
            req = reducer.requests[0];
            return resolveDelta(lastState, req.payload, reducer, req.token);
          case (Action.strategies.TAIL.toLowerCase()):
            // resolve using the last request invocation queued
            req = reducer.requests.pop();
            return resolveDelta(lastState, req.payload, reducer, req.token);
          default:
            // use tailing strategy
            req = reducer.requests.pop();
            return resolveDelta(lastState, req.payload, reducer, req.token);
        }
      }

      /**
      * @name resolveDelta
      *
      * @desc resolve a delta (difference) between the result of a sinlge action
      * invoked with `payload` and the last transient state. Applies middleware and
      *   makes an entry in the history stack
      * @returns next state after middleware has been applied and state has been
      *   set in history
      */
			function resolveDelta(lastState, payload, reducer, callToken){
        let guid = generateGuid();
        let undoInvoke = undo.bind(null, $$index + 1, guid);
        let actionInvoke = (p0) => reducer.$invoke(lastState, p0, undoInvoke, callToken);

        let meta = {
          guid: guid,
          action: reducer.name,
          payload: payload,
          reducer_index: reducer.index,
          last_state: JSON.stringify(lastState)
        };

        return applyMiddleware(actionInvoke, meta)(payload);

      }

      /**
      * @name applyMiddleware
      *
      * @desc iterate over all middleware when setting a new state
      * @returns a function to be called with an action's payload, which in turn
      * returns the next state, aka the result of `pushState`
      */
      function applyMiddleware(actionInvoke, meta){
        // ensure meta is immutable in each middleware
        let getMeta = () => meta

        if($$middleware.length){
          let middleware, getNext;

          middleware = $$middleware.map(m => m)
          getNext = i => payload_n => {
            let n = (i + 1);
            if(!isPlainObject(payload_n))
              throw new InvalidReturnError();
            if(middleware[n])
              return middleware[n](() => payload_n, getNext(n), getMeta());
          };
          // final function of the middleware stack is to apply a state update
          middleware.push(pushState);
          return payload_0 => middleware[0](() => actionInvoke(payload_0), getNext(0), getMeta());
        } else {
          return payload_0 => pushState(() => actionInvoke(payload_0), 1, getMeta());
        }
      }

      /**
      *
      * @name pushState
      * @desc function with middleware signature called as the last middleware
      * in the stack to create a new state in history
      * @returns a new state object
      */
      function pushState(getNextState, noop, meta){
        let nextState, nextImmutableState;

        nextState = getNextState();
        if( !isPlainObject(nextState) ) throw new InvalidReturnError();

        // remove any history past current index
        $$history = $$history.slice(0, $$index + 1);

        nextImmutableState = $$history[$$index].$state.mergeDeepWith(merger, nextState);
        // add a new state to the $$history and increment index
        // return state to the next reducer
        if(!Immutable.is($$history[$$index].$state, nextImmutableState)){
          $$history = $$history.slice(0, $$index + 1);
          // add new entry to history
          $$history.push({
            reducer_invoked: meta.reducer_index,
            payload: meta.payload,
            $state: nextImmutableState,
            guid: meta.guid
          });
          // update the pointer to new state in $$history
          $$index++;
        }
        return nextState;
      }

			function undo(atIndex, guid){
        // ensure that the history being undone is actually the state that this action created
        // if the history was rewound, branched, or replaced, this action no longer affects the stack
        // and an undo could break the history stack in unpredicatable ways
        if($$history[atIndex] && $$history[atIndex].guid === guid){

          let originalGuid = $$history[atIndex].guid;
          let lastHistory = $$history[atIndex - 1];

          let redo = () => {
            // ensure that a new history tree wasn't created at an index before atIndex
            if($$history[atIndex].guid === originalGuid){
              $$history[atIndex] = $$history[atIndex].original;
              queueHistoryRevision(atIndex + 1);
            }
          };

          if(!$$history[atIndex].reverted){
            // duplicate the history state of originalHistory as if action was never called
            $$history[atIndex] = {
              reducer_invoked: 0,
              payload: {},
              $state: lastHistory.$state,
              guid: originalGuid,
              reverted: true,
              original: $$history[atIndex]
            }

            // revise subsequent history entries according to revised state at index
            let fromIndex = atIndex;
            queueHistoryRevision(fromIndex);
          }

          // return a function to undo the undo
          return redo;
        } else {
          // return noOp
          return () => {};
        }
      }

      function queueHistoryRevision(fromIndex){
        pendingRevisions.push( fromIndex );
        queueReduceCycle();
      }

			function reviseHistory(fromIndex){
        let lastHistory = $$history[fromIndex - 1];

        $$history
        .slice(fromIndex)
        .reduce((last, curr, i) => {
          let reducerToApply = $$reducers.toJS()[curr.reducer_invoked];
          let revisedState = reducerToApply.$invoke(last.$state.toJS(), curr.payload);
          // update $state of the current entry
          curr.$state = last.$state.mergeDeepWith(merger, revisedState);
          return ($$history[fromIndex + i] = curr);
        }, lastHistory);
      }




      function listenToAction(action, strategy){
        let actionType = action.$$type;

        if((actionType === ACTION || actionType === ASYNC_ACTION)){
          let index = $$reducers.size;

          let reducer = {
            name: action.$$name,
            $invoke: (lastState, payload, undoFn, token) => {
              return action.$$invoke(lastState, payload, undoFn, token);
            },
            index: index,
            strategy: strategy || "TAIL",
            requests: []
          };

          // only add each Action once
          if(!contains($$reducers.toJS(), reducer)){
            $$reducers = $$reducers.push(reducer);

            if(actionType === ACTION){
              // kick off a reduce cycle when the reducer action is called anywhere in the app
              let handler = (a) => queueReduceCycle(index, a.token, a.payload);
              action.$$register(handler);
            }else if(actionType === ASYNC_ACTION){
              let handler;
            }

            let registration = {action: action.$$name, index: index}
            emitter.emit(ACTION_ADDED, registration)
            return registration;
          }
        } else {
          throw new InvalidReducerError();
        }
      }


    /**
    *
    * @name listenTo
    * @param {function | array} action - created with `new Restate.Action(<reducer_function>)`
    *   If passed an array, strategies can be defined like so: `[{action: <Action>[, strategy: <strategy>]}]`.
    *   Object definitions and plain actions can be combined in the same array:
    *   `[<Action>, {action: <Action>, strategy: <strategy>}, <Action>]`
    * @param {string} [strategy=tail] - one of `'compound'`, `'lead'`, or `'tail'`
    * @desc execute a reduce cycle when the action is called
    * @method
    * @instance
    * @memberof StateStore
    */
      this.listenTo = function listenTo(action, strategy){
        if(isFunction(action)){
          return listenToAction(action, strategy);
        } else if(isArray(action)){
          return action.reduce((acc, a) => {
            if(isFunction(a)){
              // [<Action>, <Action>, ...]
              acc[a.$$name] = listenToAction(a);
            } else if(isPlainObject(a)){
              // [{action: <Action>[,strategy: <strategy>], ...}]
              acc[a.action.$$name] = listenToAction(a.action, a.strategy);
            }
            return acc;
          }, {});
        }
      }.bind(this);

    // set the store's first reducer as a noop
    let action_noOp = new Action('noop', lastState => lastState);
    this.listenTo(action_noOp);

    // set a second reducer to handle direct setState operations
    let action_setState = new Action('setState', (lastState, deltaMap) => {
      let newState = merge({}, lastState, deltaMap);
      return newState;
    });
    this.listenTo(action_setState, Action.strategies.COMPOUND);


    /**
    *
    * @name setState
    * @desc Reduce an updated state on the next tick by merging a plain object.
    * @param {object} deltaMap - a plain object of properties to be merged into state. Set a property's
    *   value to the reserved keyword `"$unset"` to have the property removed from state.
    * @method
    * @instance
    * @fires CHANGE_EVENT
    * @memberof StateStore
    */
      this.setState = function setState(deltaMap){
        if(!isPlainObject(deltaMap)){
          throw new InvalidDeltaError();
        } else {
          return action_setState(deltaMap);
        }
      };


      // set a third reducer that entirely replaces the state with a new state
      let action_replaceState = new Action('replaceState', (lastState, newState) => {
        return reduce(lastState, (acc, val, key) => {
          acc[key] = newState[key] || "$unset";
          return acc;
        }, newState);
      });

      this.listenTo(action_replaceState, Action.strategies.TAIL)


    /**
    *
    * @name replaceState
    * @desc replace the current state with a new state. Be aware that reducers coming after may expect properties
    *   that no longer exist on the state you replace with. Best to keep them the same shape.
    * @param {object} newState - a plain object of properties to be merged into state
    * @method
    * @instance
    * @fires CHANGE_EVENT
    * @memberof StateStore
    */
      this.replaceState = function replaceState(newState){
        if(!isPlainObject(newState)){
          throw new InvalidDeltaError();
        } else {
          return action_replaceState(newState);
        }
      };

    /**
    *
    * @name reset
    * @desc Reset the app to it's original state. A hard reset will delete the state history, set the
    *   index to 0, and trigger with initial state. A soft reset will add a new entry to the end of
    *   history as initial state.
    * @param {boolean} hard=false - DESTRUCTIVE! delete entire history and start over at history[0]
    * @method
    * @instance
    * @memberof StateStore
    * @fires CHANGE_EVENT
    */
      this.reset = function reset(hard){
        if(hard === true){
          // hard reset, clears the entire $$history stack, no previous histories are saved
          $$history = [$$history[0]];
          $$index = 0;
        } else {
          // soft reset, push the initial state to the end of the $$history stack
          action_replaceState(this.getInitialState());
        }

        this.trigger();
      }.bind(this);

    /**
    *
    * @name resetToState
    * @desc reset the StateStore's history to an index. DESTRUCTIVE! Deletes history past index.
    * @param {int} index - what state to move the history to
    * @method
    * @instance
    * @memberof StateStore
    * @fires CHANGE_EVENT
    */
      this.resetToState = function resetToState(index){
        if(!Number.isInteger(index)){
          throw new InvalidIndexError();
        } else if(index >= 0 && index <= $$history.length -1){
          $$index = index;
          $$history = $$history.slice(0, $$index + 1);
          this.trigger();
        }
      }.bind(this);

    /**
    *
    * @name fastForward
    * @desc move the StateStore's history index ahead `n` frames. Does not alter history.
    * @param {int} n=1 - how many frames to fast forward. Cannot fast forward past the last frame.
    * @method
    * @instance
    * @memberof StateStore
    * @fires CHANGE_EVENT
    */
      this.fastForward = function fastForward(n){
        if(n !== undefined && !Number.isInteger(n)){
          throw new InvalidIndexError();
        } else {
          n = (n || 1)
          // ensure we don't go past the end of history
          $$index = Math.min( ($$index + Math.abs(n)), ($$history.length - 1));
          this.trigger();
        }
      }.bind(this);

    /**
    *
    * @name rewind
    * @desc move the StateStore's history index back `n` frames. Does not alter history.
    * @param {int} n=1 - how many frames to rewind. Cannot rewind past 0.
    * @method
    * @instance
    * @memberof StateStore
    * @fires CHANGE_EVENT
    */
      this.rewind = function rewind(n){
        if(n !== undefined && !Number.isInteger(n)){
          throw new InvalidIndexError();
        } else {
          n = (n || 1)
          // ensure we don't go past the beginning of time
          $$index = Math.max( ($$index - Math.abs(n)), 0)
          this.trigger();
        }
      }.bind(this);

    /**
    *
    * @name goto
    * @desc move the StateStore's history index to `index`. Does not alter history.
    * @param {int} index - the index to move to
    * @method
    * @instance
    * @memberof StateStore
    * @fires CHANGE_EVENT
    */
      this.goto = function goto(index){
        if(!Number.isInteger(index)){
          throw new InvalidIndexError();
        } else if(index >= 0 && index <= $$history.length -1){
          $$index = index;
          this.trigger();
        }
      }.bind(this);
    }

    /**
    *
    * @name getImmutableState
    * @desc Get the current state as an Immutable Map
    * @method
    * @instance
    * @memberof StateStore
    * @returns {Immutable.Map}
    */
    getImmutableState(){
      return Immutable.Map(this.history[this.index].$state);
    }


    /**
    *
    * @name getInitialState
    * @desc Get the initial app state that was passed to the constructor
    * @method
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    getInitialState(){
      return this.history[0].$state.toJS();
    }


    /**
    *
    * @name getStateAtIndex
    * @desc Get the app's state at a version in the state $$history
    * @param {int} index
    * @method
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    getStateAtIndex(index){
      if(this.history[index])
        return this.history[index].toJS();
    }

    /**
    *
    * @name addListener
    * @desc subscribe a function to changes in store state
    * @param {function} listener
    * @param {object} [thisBinding=Object.create(null)]
    * @returns {function} an unsubscribe function for the listener
    * @method
    * @instance
    * @memberof StateStore
    */
    addListener(listener, thisBinding){
      return this._emitter.on(CHANGE_EVENT, listener, thisBinding);
    }

    onchange(listener, thisBinding){
      return this.addListener(listener, thisBinding);
    }

    /**
    * @name trigger
    * @desc trigger all listeners with the current state
    * @method
    * @instance
    * @fires CHANGE_EVENT
    * @memberof StateStore
    */
    trigger(){
      this._emitter.emit(CHANGE_EVENT, this.state);
    }

    static get errors(){
      return {
        INVALID_DELTA: InvalidDeltaError,
        INVALID_RETURN: InvalidReturnError,
        INVALID_REDUCER: InvalidReducerError,
        INVALID_INDEX: InvalidIndexError
      };
    }
  }

  // polyfill
  Number.isInteger = Number.isInteger || function(value) {
    return typeof value === "number" &&
      isFinite(value) &&
      Math.floor(value) === value;
  };

};
