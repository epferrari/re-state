"use-strict";

const Action = require('./action');
const EventEmitter = require('./event-emitter');
const InvalidActionError = require("./errors/InvalidActionError");
const InvalidDeltaError = require('./errors/InvalidDeltaError');
const InvalidReturnError = require('./errors/InvalidReturnError');
const InvalidReducerError = require('./errors/InvalidReducerError');
const InvalidIndexError = require('./errors/InvalidIndexError');
const CircularInvocationError = require('./errors/CircularInvocationError');
const {getter, defineProperty} = require('./utils');
const {
  ACTION, ASYNC_ACTION,
  STATE_CHANGE, REDUCE_INVOKED,
  READY, QUEUED, REDUCING } = require('./constants');

module.exports = function storeFactory(Immutable, lodash, generateGuid){

  let {
    isPlainObject,
    isFunction,
    isArray,
    merge,
    reduce,
    chain,
    contains,
    findIndex} = lodash;

  return class StateStore {
    /**
    * @constructs StateStore
    * @param {object} initialState={} - an initial state for your store
    * @param {array} [middleware=[]] - an array of middleware functions to apply during state transitions
    */
    constructor(initialState, middleware){

      var $$container_id = generateGuid(),
          $$history,
          $$index,
          $$reducers,
          $$middleware,
          emitter,
          trigger,
          currentState,
          phase = READY,
          reducePending = false,
          reduceExecuting = false,
          pendingRevisions = [];



      if(typeof initialState !== 'undefined' && !isPlainObject(initialState))
        throw new InvalidDeltaError();

      // pointer to current state of $$history
      $$index = 0;

      // list of reducers invoked to change state
      $$reducers = Immutable.List();

      // private stack of [reducer index, Immutable Map app state]
      $$history = [{
        reducerInvoked: 0,
        payload: {},
        $state: Immutable.Map().merge(initialState),
        guid: generateGuid()
      }];


      $$middleware = isArray(middleware) ? middleware : [];

      emitter = new EventEmitter();

      currentState = () => {
        let state = Immutable.Map($$history[$$index].$state).toJS();
        return reduce(state, (acc, val, key) => {
          if(val !== undefined)
            acc[key] = val;
          return acc;
        }, {});
      };

      trigger = () => this.trigger();

      // get accessors
      getter(this, 'reducers', () => $$reducers.toJS() );
      getter(this, 'depth', () => $$history.length);
      getter(this, 'history', () => $$history);
      getter(this, 'index', () => $$index);
      getter(this, 'state', () => currentState());
      getter(this, '_emitter', () => emitter );


      /**
      * @desc merger for Immutable states - respects "$unset" value passed
      * to remove a value from state
      * @private
      */
      function merger(prev, next, key){
        if(next == "$unset")
          return undefined;
        else if(next === undefined)
          return prev;
        else
          return next;
      };


      /**
      * @desc queue a reduce cycle on next tick
      * @private
      */
      function queueReduceCycle(index, token, payload){
        if(arguments.length){
          if(phase === REDUCING){
            throw new CircularInvocationError();
          } else {
            // update reducer hash in $$reducers with action's payload
            $$reducers = $$reducers.update(index, reducer => {
              reducer.requests.push({payload: payload, token: token});
              return reducer;
            });
          }
        }

        if(phase !== QUEUED){
          phase = QUEUED;

          // reduce over any queued actions and undo/redo revisions and
          // determine whether to push out a state change
          setTimeout(() => {
            phase = REDUCING;
            let shouldTrigger;

            if(pendingRevisions.length){
              shouldTrigger = true;
              pendingRevisions.forEach(reviseHistory);
              pendingRevisions = [];
            }

            shouldTrigger = executeReduceCycle(currentState()) || shouldTrigger;

            phase = READY;
            if(shouldTrigger) trigger();
          }, 0);
        }
      };


			/**
      * @name executeReduceCycle
      * @desc resolve a series of new states from pending $$reducers
      * @private
      */
      function executeReduceCycle(previousState){
        emitter.emit(REDUCE_INVOKED);
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
      * @desc resolve an action's invocation against the last state according
      *   to the strategy defined for the action
      * @private
      * @returns the updated state
      */
			function resolveReducer(lastState, reducer){
        switch((reducer.strategy || "").toLowerCase()){
          case (Action.strategies.COMPOUND.toLowerCase()):
            // reduce down all the requested invocations
            return reduce(reducer.requests, (state, request) => {
              return resolveRequest(state, reducer, request);
            }, lastState);
          case (Action.strategies.HEAD.toLowerCase()):
            // transform using the first requested invocation queued
            return resolveRequest(lastState, reducer, reducer.requests[0]);
          case (Action.strategies.TAIL.toLowerCase()):
            // resolve using the last request invocation queued
            return resolveRequest(lastState, reducer, reducer.requests.pop());
          default:
            // use tailing strategy
            return resolveRequest(lastState, reducer, reducer.requests.pop());
        }
      }

      /**
      * @name resolveRequest
      * @desc resolve a single requested invocation of the reducer handling an
      *   action with with action call's `payload` and the last transient state.
      *   Applies middleware and pushes an entry to the history stack
      * @private
      * @returns next state after middleware has been applied and state has been
      *   set in history
      */
			function resolveRequest(lastState, reducer, request){
        let guid = generateGuid();
        //let undoInvoke = undo.bind(null, $$index + 1, guid);
        let auditRecord = {
          $$container_id: $$container_id,
          $$index: ($$index + 1),
          guid: guid
        };
        let {token, payload, canceled} = request;
        let reducerInvoke = (p0) => reducer.invoke(lastState, p0, auditRecord, token);

        let meta = {
          guid: guid,
          action: reducer.trigger,
          canceled: canceled,
          payload: payload,
          reducer_index: reducer.index,
          last_state: JSON.stringify(lastState)
        };

        return applyMiddleware(reducerInvoke, meta)(payload);

      }

      /**
      * @name applyMiddleware
      * @desc iterate over all middleware when setting a new state
      * @private
      * @returns a function to be called with an action's payload, which in turn
      * returns the next state, aka the result of `pushState`
      */
      function applyMiddleware(reducerInvoke, meta, revision){
        // ensure meta is immutable in each middleware
        let getMeta = () => meta;
        let exports = {};

        if($$middleware.length){
          let middleware, getNext;

          middleware = $$middleware.map(m => m)
          getNext = i => payload_n => {
            let n = (i + 1);
            if(!isPlainObject(payload_n))
              throw new InvalidReturnError();
            if(middleware[n])
              return middleware[n](() => payload_n, getNext(n), getMeta(), exports);
          };

          if(revision)
            middleware.push( (prev, next, meta) => next(prev()) )
          else
            // final function of the middleware stack is to apply a state update
            middleware.push(pushState);

          return payload_0 => middleware[0](() => reducerInvoke(payload_0), getNext(0), getMeta());
        } else {
          if(revision)
            return reducerInvoke
          else
            return payload_0 => pushState(() => reducerInvoke(payload_0), 1, getMeta());
        }
      }

      /**
      * @name pushState
      * @desc function with middleware signature called as the last middleware
      * in the stack to create a new state in history
      * @private
      * @returns a new state object
      */
      function pushState(getDelta, noop, meta){
        let delta, nextImmutableState;

        delta = getDelta();
        if( !isPlainObject(delta) ) throw new InvalidReturnError();

        // remove any history past current index
        $$history = $$history.slice(0, $$index + 1);

        nextImmutableState = $$history[$$index].$state.mergeDeepWith(merger, delta);
        // add a new state to the $$history and increment index
        // return state to the next reducer
        if(!Immutable.is($$history[$$index].$state, nextImmutableState)){
          $$history = $$history.slice(0, $$index + 1);
          // add new entry to history
          $$history.push({
            reducerInvoked: meta.reducer_index,
            payload: meta.payload,
            $state: nextImmutableState,
            guid: meta.guid,
            delta: delta
          });
          // update the pointer to new state in $$history
          $$index++;

          // ensure a history state is created, but immediately revert it
          if(meta.canceled)
            undo($$index, meta.guid);
        }
        return nextImmutableState.toJS();
      }

			function undo(atIndex, guid){
        // ensure that the history being undone is actually the state that this action created
        // if the history was rewound, branched, or replaced, this action no longer affects the stack
        // and an undo could break the history stack in unpredicatable ways
        if($$history[atIndex] && $$history[atIndex].guid === guid){

          //let originalGuid = $$history[atIndex].guid;
          let lastHistory = $$history[atIndex - 1];

          if(!$$history[atIndex].reverted){
            // duplicate the history state of originalHistory as if action was never called
            $$history[atIndex] = {
              reducerInvoked: 0,
              payload: {},
              $state: lastHistory.$state,
              guid: guid,
              reverted: true,
              original: $$history[atIndex]
            }

            // revise subsequent history entries according to revised state at index
            let fromIndex = atIndex;
            queueHistoryRevision(fromIndex);
          }

          return true;
        } else {
          return false;
        }
      }

      function redo(atIndex, guid){
        // ensure that a new history tree wasn't created at an index before atIndex
        if($$history[atIndex].guid === guid){
          $$history[atIndex] = $$history[atIndex].original;
          queueHistoryRevision(atIndex + 1);
          return true;
        } else {
          return false;
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
          let reducer = $$reducers.toJS()[curr.reducerInvoked];
          let reducerInvoke = payload_0 => reducer.invoke(last.$state.toJS(), payload_0);

          // mimic resolveRequest for the middleware, pass true for `revision`
          let revisedState = applyMiddleware(reducerInvoke, null, true)(curr.payload)

          // mimic pushState for the merge
          curr.$state = last.$state.mergeDeepWith(merger, revisedState);
          return ($$history[fromIndex + i] = curr);
        }, lastHistory);
      }


      function updatePendingReducer(atIndex, requestToken, config){
        // cancel the action request if it is pending
        $$reducers = $$reducers.update(atIndex, reducer => {
          let pIndex = findIndex(reducer.requests, r => (r.token === requestToken));
          if(pIndex >= 0)
            reducer.requests[pIndex].canceled = config.canceled;
          return reducer;
        });
      }

      let triggerAction = Symbol("trigger action");
      this[triggerAction] = new Action("trigger");

      // reducer(lastState, otherStoreState){}
      /*
      function listenToStore(store, reducerFn){
        let index = $$reducers.size;
        let reducer = {
          trigger: "",
          invoke: (lastState, payload, auditRecord, indexToken){
            payload = store.getState(indexToken)
            reducerFn(lastState, payload)
          }
        }

        store[triggerAction]
        store.onchange((storeState) => {

          queueReduceCycle(index, store.index, storeState)
          let i = store.index;
          let stateSnapshot = store.getState(i);
          // when any undo or redo op is triggered on store, we need to re-evaluate
          // the store's state at index and listening store's history accordingly
          queueHistoryRevision
        }
      }
      */

      function listenToAction(action, reducerFn, strategy){
        let actionType = action.$$type;

        if(!reducerFn) throw new InvalidReducerError();

        if(actionType !== ACTION) throw new InvalidActionError();

        let index = $$reducers.size;

        let reducer = {
          trigger: action.$$name,
          // right now reviseHistory is triggering action.didInvoke, which is incorrect?
          // but revise history doesn't call the middleware, so its not accurately revising
          invoke: (lastState, payload, auditRecord, token) => {
            action.didInvoke(token, auditRecord)
            return reducerFn(lastState, payload);
          },
          index: index,
          strategy: strategy || "TAIL",
          requests: []
        };

        // only add each Action once
        if(!contains($$reducers.toJS(), reducer)){
          $$reducers = $$reducers.push(reducer);

          // kick off a reduce cycle when the reducer action is called anywhere in the app
          action.onTrigger(
            request => queueReduceCycle(index, request.token, request.payload)
          );

          action.onUndo(
            (token, auditRecords) => {
              // cancel invocation request if pending
              updatePendingReducer(index, token, {canceled: true});

              // if not pending, then an action alters history and it will have
              // sent an audit record to the action to cache by its callCount token.
              // Actions may be listened to by multiple state containers, and may
              // therefore have multiple audit records attached to each call.
              // However, this state container will only execute an undo when the guid
              // of the audit record matches the index of the state it changed, so
              // we can count on it to be unique against this state container
              let auditRecord = auditRecords.find(ar => {
                return (ar.$$container_id === $$container_id);
              });
              auditRecord && undo(auditRecord.$$index, auditRecord.guid);
            }
          );

          action.onRedo(
            (token, auditRecords) => {
              // resume normal workflow for undone pending reduce request
              updatePendingReducer(index, token, {canceled: false})
              // see above for iteration reasoning
              let auditRecord = auditRecords.find(ar => {
                return (ar.$$container_id === $$container_id);
              });
              auditRecord && redo(auditRecord.$$index, auditRecord.guid);
            }
          );

          return {action: action.$$name, index: index};
        }
      }


    /**
    *
    * @name when
    * @param {Action} action - created with `new Action(action_name)`
    *   If passed an array, strategies can be defined like so:
    *   ```
    *   [
    *     {action: <Action>, reducer: <function> [,strategy: <strategy>]},
    *     {action: <Action>, reducer: <function> [,strategy: <strategy>]},
    *     ...
    *   ]
    *   ```
    * @param {function} reducer - the reducer function to execute when the action is called
    * @param {string} [strategy=tail] - one of `'compound'`, `'lead'`, or `'tail'`
    * @desc invoke a reducer against the current state with the payload passed to
    *   action. `reducer` is invoked asyncronously in order relative to other actions being
    *   listened to with `<StateContainer>.when`
    * @method
    * @instance
    * @memberof StateStore
    */
      this.when = function when(action, reducer, strategy){
        if( isFunction(action) ){
          listenToAction(action, reducer, strategy);
        } else if(isArray(action)){
          action.forEach((o) => {
            if(isPlainObject(o)){
              /*

              */
              listenToAction(o.action, o.reducer, o.strategy);
            }
          });
        }
        return this;
      };

      // set the store's first reducer as a noop
      this.when(new Action('noop'), lastState => lastState);

      // set a second reducer to handle direct setState operations
      let action_setState = new Action("setState");
      let reducer_setState = (lastState, deltaMap) => merge({}, lastState, deltaMap);

      this.when(action_setState, reducer_setState, Action.strategies.COMPOUND);


    /**
    *
    * @name setState
    * @desc Reduce an updated state on the next tick by merging a plain object.
    * @param {object} deltaMap - a plain object of properties to be merged into state. Set a property's
    *   value to the reserved keyword `"$unset"` to have the property removed from state.
    * @method
    * @instance
    * @fires STATE_CHANGE
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
      let action_replaceState = new Action('replaceState');
      let reducer_replaceState = (lastState, newState) => {
        return reduce(lastState, (acc, val, key) => {
          acc[key] = newState[key] || "$unset";
          return acc;
        }, newState);
      };

      this.when(action_replaceState, reducer_replaceState, Action.strategies.TAIL);


    /**
    *
    * @name replaceState
    * @desc replace the current state with a new state. Be aware that reducers coming after may expect properties
    *   that no longer exist on the state you replace with. Best to keep them the same shape.
    * @param {object} newState - a plain object of properties to be merged into state
    * @method
    * @instance
    * @fires STATE_CHANGE
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
    * @fires STATE_CHANGE
    */
      this.reset = function reset(hard){
        if(hard === true){
          // hard reset, clears the entire $$history stack, no previous histories are saved
          $$history = [$$history[0]];
          $$index = 0;
          trigger();
        } else {
          // soft reset, push the initial state to the end of the $$history stack
          action_replaceState(this.getInitialState());
        }
      }.bind(this);

    /**
    *
    * @name resetToState
    * @desc reset the StateStore's history to an index. DESTRUCTIVE! Deletes history past index.
    * @param {int} index - what state to move the history to
    * @method
    * @instance
    * @memberof StateStore
    * @fires STATE_CHANGE
    */
      this.resetToState = function resetToState(index){
        if(!Number.isInteger(index)){
          throw new InvalidIndexError();
        } else if(index >= 0 && index <= $$history.length -1){
          $$index = index;
          $$history = $$history.slice(0, $$index + 1);
          trigger();
        }
      };

    /**
    *
    * @name fastForward
    * @desc move the StateStore's history index ahead `n` frames. Does not alter history.
    * @param {int} n=1 - how many frames to fast forward. Cannot fast forward past the last frame.
    * @method
    * @instance
    * @memberof StateStore
    * @fires STATE_CHANGE
    */
      this.fastForward = function fastForward(n){
        if(n !== undefined && !Number.isInteger(n)){
          throw new InvalidIndexError();
        } else {
          n = (n || 1)
          // ensure we don't go past the end of history
          $$index = Math.min( ($$index + Math.abs(n)), ($$history.length - 1));
          trigger();
        }
      };

    /**
    *
    * @name rewind
    * @desc move the StateStore's history index back `n` frames. Does not alter history.
    * @param {int} n=1 - how many frames to rewind. Cannot rewind past 0.
    * @method
    * @instance
    * @memberof StateStore
    * @fires STATE_CHANGE
    */
      this.rewind = function rewind(n){
        if(n !== undefined && !Number.isInteger(n)){
          throw new InvalidIndexError();
        } else {
          n = (n || 1)
          // ensure we don't go past the beginning of time
          $$index = Math.max( ($$index - Math.abs(n)), 0)
          trigger();
        }
      };

    /**
    *
    * @name goto
    * @desc move the StateStore's history index to `index`. Does not alter history.
    * @param {int} index - the index to move to
    * @method
    * @instance
    * @memberof StateStore
    * @fires STATE_CHANGE
    */
      this.goto = function goto(index){
        if(!Number.isInteger(index)){
          throw new InvalidIndexError();
        } else if(index >= 0 && index <= $$history.length -1){
          $$index = index;
          trigger();
        }
      };
    }

    // end constructor
    // start prototype methods

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
    * @name getState
    * @desc Get the app's state at a version in history
    * @param {int} [index=current]
    * @method
    * @instance
    * @memberof StateStore
    * @returns {object} state
    */
    getState(index){
      if(index === undefined) index = this.index;
      if(this.history[index])
        return this.history[index].$state.toJS();
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
      return this._emitter.on(STATE_CHANGE, listener, thisBinding);
    }

    onchange(listener, thisBinding){
      return this.addListener(listener, thisBinding);
    }

    /**
    * @name trigger
    * @desc trigger all listeners with the current state and last state
    * @method
    * @instance
    * @fires STATE_CHANGE
    * @memberof StateStore
    */
    trigger(){
      this._emitter.emit(
        STATE_CHANGE,
        this.state,
        this.getState(this.index - 1)
      );
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
