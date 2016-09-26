"use-strict";

const Action = require('./action');
const EventEmitter = require('./event-emitter');
const InvalidActionError = require("./errors/InvalidActionError");
const InvalidDeltaError = require('./errors/InvalidDeltaError');
const InvalidReturnError = require('./errors/InvalidReturnError');
const InvalidReducerError = require('./errors/InvalidReducerError');
const InvalidIndexError = require('./errors/InvalidIndexError');
const CircularInvocationError = require('./errors/CircularInvocationError');
const {getter, defineProperty, typeOf} = require('./utils');
const {
  ACTION, ASYNC_ACTION,
  STATE_CHANGE,
  READY, QUEUED, REDUCING,
  RESOLVE, CANCEL, UNDO, REDO} = require('./constants');

module.exports = function storeFactory(Immutable, lodash, generateGuid){

  let {
    clone,
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
          pendingRevisions = [];



      if(typeof initialState !== 'undefined' && !isPlainObject(initialState))
        throw new InvalidDeltaError();

      // pointer to current state of $$history
      $$index = 0;

      // list of reducers invoked to change state
      $$reducers = Immutable.List();

      // private stack of [reducer index, Immutable Map app state]
      $$history = Immutable.List([{
        reducerInvoked: 0,
        payload: {},
        $state: Immutable.Map().merge(initialState),
        guid: generateGuid()
      }]);

      $$middleware = isArray(middleware) ? middleware : [];

      emitter = new EventEmitter();

      currentState = () => {
        let entry = $$history.get($$index);
        return entry.$state.reduce((acc, val, key) => {
          if(val !== undefined){
            if(typeOf(val.toJS) === 'function')
              val = val.toJS();
            acc[key] = val;
          }
          return acc;
        }, {});
      };

      trigger = () => this.trigger();

      // get accessors
      getter(this, 'reducers', () => $$reducers.toJS() );
      getter(this, 'depth', () => $$history.size);
      getter(this, 'history', () => $$history.toArray());
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

      function createAuditRecord(forIndex){
        return {
          $$container_id,
          $$index: forIndex,
          guid: generateGuid()
        };
      }


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
            // TODO: possibly provide option for revisions to happen after reduce cycle?
            let shouldTrigger = (resolveRevisions() || resolveActions());
            phase = READY;
            if(shouldTrigger) trigger();
          }, 0);
        }
      };


      /**
      * @desc
      * @private
      * @returns {boolean} - whether the store should trigger an update
      */
      function resolveRevisions(){
        if(pendingRevisions.length){
          let fromIndex = pendingRevisions.reduce((acc, n) => {
            return Math.min(n, acc);
          }, pendingRevisions[0]);

          reviseHistory(fromIndex);
          pendingRevisions = [];
          return true;
        } else {
          return false;
        }
      }

      /**
      * @name resolveActions
      * @desc apply each pending action request to state according to its strategy
      * @private
      * @returns {boolean} - whether the store should trigger an update
      */
      function resolveActions(){
        let initialIndex = $$index;
        let reducersToCall = chain($$reducers.toJS())
          .filter(reducer => reducer.requests.length)
          .sortBy(reducer => reducer.position)
          .value()

        reduce(reducersToCall, (state, reducer) => {
          // run the state through the reducer
          let nextState = resolveReducer(state, reducer);
          // clear action requests for the next cycle and create new immutable list
          $$reducers = $$reducers.update(reducer.position, r => {
            r.requests = [];
            return r;
          });
          return nextState;
        }, merge({}, currentState()) );

        // was history updated?
        return (initialIndex !== $$index);
      }


      /**
      * @name resolveReducer
      * @desc resolve an action's invocation against the last state according
      *   to the strategy defined for the action
      * @private
      * @returns {object} - the updated state
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
      * @returns {object} - next state after middleware has been applied and state has been
      *   set in history
      */
			function resolveRequest(lastState, reducer, request){
        let auditRecord = createAuditRecord($$index + 1);
        let {token, payload, canceled} = request;
        let reducerInvoke = (p0) => reducer.invoke(lastState, p0, auditRecord, token);

        let meta = {
          action_name: reducer.actionName,
          guid: auditRecord.guid,
          index: ($$index + 1),
          last_state: JSON.stringify(lastState),
          operation: (canceled ? CANCEL : RESOLVE),
          payload: payload,
          reducer_position: reducer.position
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
      function applyMiddleware(reducerInvoke, meta){
        let isRevision = (meta.operation === UNDO) || (meta.operation === REDO);
        if($$middleware.length){
          let middleware, getNext, exports = {};

          middleware = $$middleware.map(m => m)
          getNext = i => payload_n => {
            let n = (i + 1);
            if(!isPlainObject(payload_n))
              throw new InvalidReturnError();
            if(middleware[n])
              return middleware[n](() => payload_n, getNext(n), clone(meta), exports);
          };

          if(isRevision)
            // just pass the transformed state thru as the final fn in middleware
            middleware.push( (prev, next, meta) => next(prev()) )
          else
            // final function of the middleware stack is to apply a state update
            middleware.push(pushState);

          return (payload_0) =>
            middleware[0](() => reducerInvoke(payload_0), getNext(0), clone(meta));
        } else {
          if(isRevision)
            return reducerInvoke;
          else
            return (payload_0) =>
              pushState(() => reducerInvoke(payload_0), 1, clone(meta));
        }
      }

      /**
      * @name pushState
      * @desc function with middleware signature called as the last middleware
      * in the stack to create a new state in history
      * @private
      * @returns {object} - the most current state in history
      */
      function pushState(getDelta, noop, meta){
        let delta, lastState, nextState;

        delta = getDelta();
        if( !isPlainObject(delta) ) throw new InvalidReturnError();

        lastState = $$history.get($$index).$state;
        nextState = lastState.mergeDeepWith(merger, delta);
        // add a new state to the $$history and increment index
        // return state to the next reducer
        if(!Immutable.is(lastState, nextState)){
          // remove any history past current index
          $$history = $$history.slice(0, $$index + 1);

          let entry = {
            $state: nextState,
            guid: meta.guid,
            original: undefined,
            payload: meta.payload,
            reducerInvoked: meta.reducer_position,
            reverted: false
          };

          // add new entry to history
          $$history = $$history.push(entry);

          // update the pointer to new state in $$history
          $$index++;

          // ensure a history state is created, but immediately revert it syncronously
          // so we don't kick off a new reduce cycle
          if(meta.operation === CANCEL)
            undo($$index, meta.guid);
        }

        return currentState();
      }

			function undo(atIndex, guid){
        // ensure that the history being undone is actually the state that this action created
        // if the history was rewound, branched, or replaced, this action no longer affects the stack
        // and an undo could break the history stack in unpredicatable ways
        let entry = $$history.get(atIndex);
        if(
          entry &&
          (entry.guid === guid) &&
          !entry.reverted
        ){
          let lastEntry = $$history.get(atIndex - 1);
          // this history entry's state becomes identical to the last entry, the
          // payload is an empty object, and the reducer invoked becomes a pass thrus
          $$history = $$history.set(atIndex, {
            $state: lastEntry.$state,
            guid: guid,
            original: entry,
            payload: {},
            reducerInvoked: 0,
            reverted: true
          });
          return true;
        } else {
          return false;
        }
      }

      function queueUndo(atIndex, guid){
        if(undo(atIndex, guid))
          // revise subsequent history entries according to revised state at index
          queueHistoryRevision(atIndex);
      }

      function redo(atIndex, guid){
        // ensure that we're in the correct history tree, as above in `undo`
        let entry = $$history.get(atIndex);
        if(
          entry &&
          (entry.guid === guid) &&
          entry.reverted
        ){
          $$history = $$history.set(atIndex, entry.original);
          return true;
        } else {
          return false;
        }
      }

      function queueRedo(atIndex, guid){
        if(redo(atIndex, guid))
          // revise subsequent history entries according to revised state at index
          queueHistoryRevision(atIndex);
      }

      function queueHistoryRevision(fromIndex){
        pendingRevisions.push( fromIndex );
        queueReduceCycle();
      }

			function reviseHistory(fromIndex){
        $$history
          .toSeq()
          .slice(fromIndex)
          .reduce((prevEntry, entry, i) => {
            let reducers = $$reducers.toJS(),
                reducer = reducers[entry.reducerInvoked],
                prevState = prevEntry.$state.toJS(),
                reducerInvoke = payload_0 => reducer.invoke(prevState, payload_0),
                originalReducer;

            if(entry.reverted){
              originalReducer = reducers[entry.original.reducerInvoked];
            }else{
              originalReducer = reducer;
            }

            // mimic resolveRequest for the middleware
            let meta = {
              action_name: originalReducer.actionName,
              guid: entry.guid,
              index: (fromIndex + i),
              last_state: JSON.stringify(prevState),
              operation: (entry.reverted ? UNDO : REDO),
              payload: entry.payload,
              reducer_position: originalReducer.position,
            };

            let revisedDelta = applyMiddleware(reducerInvoke, meta)(entry.payload);

            // mimic the merge in pushState, but don't create a new entry
            entry.$state = prevEntry.$state.mergeDeepWith(merger, revisedDelta);
            $$history = $$history.set((fromIndex + i), entry);
            return entry;
          }, $$history.get(fromIndex - 1));
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
        store.onchange((storeState, lastStoreState, updatedIndicies) => {

          // need to look at <subscriber>'s $$history and re-calculate
          // everything from the first index that <emitter> started
          // affecting <subscriber>. First, for each entry in <subscriber's> history,
          // must replace the payload with <emitter>'s state at affecting index.

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

        let position = $$reducers.size;

        let reducer = {
          actionName: action.$$name,
          invoke: (lastState, payload, auditRecord, token) => {
            if(auditRecord && token)
              // only record invocation if not a revision
              action.didInvoke(token, auditRecord)
            return reducerFn(lastState, payload);
          },
          position: position,
          requests: [],
          strategy: (strategy || "TAIL")
        };

        // only add each Action once
        if(!contains($$reducers.toJS(), reducer)){
          $$reducers = $$reducers.push(reducer);

          // kick off a reduce cycle when the reducer action is called anywhere in the app
          action.onTrigger(
            request => queueReduceCycle(position, request.token, request.payload)
          );

          action.onUndo(
            (token, auditRecords) => {
              // cancel invocation request if pending
              updatePendingReducer(position, token, {canceled: true});

              // if not pending, then an action alters history and it will have
              // sent an audit record to the Action to cache by its callCount token.
              // Actions may be listened to by multiple state containers, and may
              // therefore have multiple audit records attached to each call.
              // However, THIS state container should only evaluate an undo when the guid
              // of the audit record matches the index of the state it changed,
              // AND the container_id of the audit record matches this container's
              // container_id so we can count on it to undo the correct state transformation.
              let auditRecord = auditRecords.find(ar => {
                return (ar.$$container_id === $$container_id);
              });
              auditRecord && queueUndo(auditRecord.$$index, auditRecord.guid);
            }
          );

          action.onRedo(
            (token, auditRecords) => {
              // resume normal workflow for undone but still pending reduce request
              updatePendingReducer(position, token, {canceled: false});
              // see above for iteration reasoning
              let auditRecord = auditRecords.find(ar => {
                return (ar.$$container_id === $$container_id);
              });
              auditRecord && queueRedo(auditRecord.$$index, auditRecord.guid);
            }
          );

          action.onCancel(
            (token) => {
              updatePendingReducer(position, token, {canceled: true});
            }
          );
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
          action.forEach(o => {
            if(isPlainObject(o)){
              listenToAction(o.action, o.reducer, o.strategy);
            }
          });
        }
        return this;
      };

      // set the store's first reducer as a noop
      // we use this action/reducer when a state has been reverted so it gets
      // so it gets passed through on subsequent revisions further back in the stack
      this.when(new Action('noop'), lastState => lastState);

      // set a second reducer to handle direct setState operations
      let setStateAction = new Action("setState");
      let setStateReducer = (lastState, deltaMap) => merge({}, lastState, deltaMap);
      this.when(setStateAction, setStateReducer, Action.strategies.COMPOUND);

      // set a third reducer that entirely replaces the state with a new state
      let replaceStateAction = new Action('replaceState');
      let replaceStateReducer = (lastState, newState) => {
        return reduce(lastState, (acc, val, key) => {
          acc[key] = newState[key] || "$unset";
          return acc;
        }, newState);
      };
      this.when(replaceStateAction, replaceStateReducer, Action.strategies.TAIL);

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
          return setStateAction(deltaMap);
        }
      };


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
          return replaceStateAction(newState);
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
          $$history = $$history.setSize(1);
          $$index = 0;
          trigger();
        } else {
          // soft reset, push the initial state to the end of the $$history stack
          replaceStateAction(this.getInitialState());
        }
      };

    /**
    *
    * @name revert
    * @desc reset the StateStore's history to an index. DESTRUCTIVE! Deletes history past index.
    * @param {int} index - what state to move the history to
    * @method
    * @instance
    * @memberof StateStore
    * @fires STATE_CHANGE
    */
      this.revert = function revert(index){
        if(!Number.isInteger(index)){
          throw new InvalidIndexError();
        } else if(index >= 0 && index <= $$history.size -1){
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
          $$index = Math.min( ($$index + Math.abs(n)), ($$history.size - 1));
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
        } else if(index >= 0 && index <= $$history.size -1){
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
    * @name onchange
    * @desc subscribe a function to changes in store state
    * @param {function} listener
    * @param {object} [thisBinding=Object.create(null)]
    * @returns {function} an unsubscribe function for the listener
    * @method
    * @instance
    * @memberof StateStore
    */
    onchange(listener, thisBinding){
      return this._emitter.on(STATE_CHANGE, listener, thisBinding);
    }

    addListener(listener, thisBinding){
      return this.onchange(listener, thisBinding);
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
