"use strict";
"use-strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var merge = require("lodash.merge");
var Action = require('./action');
var EventEmitter = require('./event-emitter');
var InvalidActionError = require("./errors/InvalidActionError");
var InvalidDeltaError = require('./errors/InvalidDeltaError');
var InvalidReturnError = require('./errors/InvalidReturnError');
var InvalidReducerError = require('./errors/InvalidReducerError');
var InvalidIndexError = require('./errors/InvalidIndexError');
var CircularInvocationError = require('./errors/CircularInvocationError');

var _require = require('./utils');

var getter = _require.getter;
var defineProperty = _require.defineProperty;
var typeOf = _require.typeOf;
var isArray = _require.isArray;
var isFunction = _require.isFunction;
var isPlainObject = _require.isPlainObject;

var _require2 = require('./constants');

var ACTION = _require2.ACTION;
var ASYNC_ACTION = _require2.ASYNC_ACTION;
var STATE_CHANGE = _require2.STATE_CHANGE;
var READY = _require2.READY;
var QUEUED = _require2.QUEUED;
var REDUCING = _require2.REDUCING;
var RESOLVE = _require2.RESOLVE;
var CANCEL = _require2.CANCEL;
var UNDO = _require2.UNDO;
var REDO = _require2.REDO;


module.exports = function storeFactory(Immutable, generateGuid) {
  var clone = function clone(obj) {
    return Immutable.Map(obj).toJS();
  };

  return function () {
    /**
    * @constructs StateContainer
    * @param {object} initialState={} - an initial state for your store
    * @param {array} [middleware=[]] - an array of middleware functions to apply during state transitions
    */

    function StateContainer(initialState, middleware) {
      var _this = this;

      _classCallCheck(this, StateContainer);

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

      if (typeof initialState !== 'undefined' && !isPlainObject(initialState)) throw new InvalidDeltaError();

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

      currentState = function currentState() {
        var entry = $$history.get($$index);
        return entry.$state.reduce(function (acc, val, key) {
          if (val !== undefined) {
            if (typeOf(val.toJS) === 'function') val = val.toJS();
            acc[key] = val;
          }
          return acc;
        }, {});
      };

      trigger = function trigger() {
        return _this.trigger();
      };

      // get accessors
      getter(this, 'reducers', function () {
        return $$reducers.toJS();
      });
      getter(this, 'depth', function () {
        return $$history.size;
      });
      getter(this, 'history', function () {
        return $$history.toArray();
      });
      getter(this, 'index', function () {
        return $$index;
      });
      getter(this, 'state', function () {
        return currentState();
      });
      getter(this, '_emitter', function () {
        return emitter;
      });

      /**
      * @desc merger for Immutable states - respects "$unset" value passed
      * to remove a value from state
      * @private
      */
      function merger(prev, next, key) {
        if (next == "$unset") return undefined;else if (next === undefined) return prev;else return next;
      };

      function createAuditRecord(forIndex) {
        return {
          $$container_id: $$container_id,
          $$index: forIndex,
          guid: generateGuid()
        };
      }

      /**
      * @desc queue a reduce cycle on next tick
      * @private
      */
      function queueReduceCycle(index, token, payload) {
        if (arguments.length) {
          if (phase === REDUCING) {
            throw new CircularInvocationError();
          } else {
            // update reducer hash in $$reducers with action's payload
            $$reducers = $$reducers.update(index, function (reducer) {
              reducer.requests.push({ payload: payload, token: token });
              return reducer;
            });
          }
        }

        if (phase !== QUEUED) {
          phase = QUEUED;

          // reduce over any queued actions and undo/redo revisions and
          // determine whether to push out a state change
          setTimeout(function () {
            phase = REDUCING;
            // TODO: possibly provide option for revisions to happen after reduce cycle?
            var shouldTrigger = resolveRevisions() || resolveActions();
            phase = READY;
            if (shouldTrigger) trigger();
          }, 0);
        }
      };

      /**
      * @desc
      * @private
      * @returns {boolean} - whether the store should trigger an update
      */
      function resolveRevisions() {
        if (pendingRevisions.length) {
          var fromIndex = pendingRevisions.reduce(function (acc, n) {
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
      function resolveActions() {
        var initialIndex = $$index;
        $$reducers.filter(function (reducer) {
          return reducer.requests.length;
        }).sortBy(function (reducer) {
          return reducer.position;
        }).reduce(function (state, reducer) {
          // run the state through the reducer
          var nextState = resolveReducer(state, reducer);
          // clear action requests for the next cycle and create new immutable list
          $$reducers = $$reducers.update(reducer.position, function (r) {
            r.requests = [];
            return r;
          });
          return nextState;
        }, currentState());

        // was history updated?
        return initialIndex !== $$index;
      }

      /**
      * @name resolveReducer
      * @desc resolve an action's invocation against the last state according
      *   to the strategy defined for the action
      * @private
      * @returns {object} - the updated state
      */
      function resolveReducer(lastState, reducer) {
        var requests = reducer.requests;

        switch ((reducer.strategy || "").toLowerCase()) {
          case Action.strategies.COMPOUND.toLowerCase():
            // reduce down all the requested invocations
            return Immutable.Seq(requests).reduce(function (state, request) {
              return resolveRequest(state, reducer, request);
            }, lastState);
          case Action.strategies.HEAD.toLowerCase():
            // transform using the first requested invocation queued
            return resolveRequest(lastState, reducer, requests[0]);
          case Action.strategies.TAIL.toLowerCase():
            // resolve using the last request invocation queued
            return resolveRequest(lastState, reducer, requests.pop());
          default:
            // use tailing strategy
            return resolveRequest(lastState, reducer, requests.pop());
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
      function resolveRequest(lastState, reducer, request) {
        var auditRecord = createAuditRecord($$index + 1);
        var token = request.token;
        var payload = request.payload;
        var canceled = request.canceled;

        var reducerInvoke = function reducerInvoke(p0) {
          return reducer.invoke(lastState, p0, auditRecord, token);
        };

        var meta = {
          action_name: reducer.actionName,
          guid: auditRecord.guid,
          index: $$index + 1,
          last_state: JSON.stringify(lastState),
          operation: canceled ? CANCEL : RESOLVE,
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
      function applyMiddleware(reducerInvoke, meta) {
        var isRevision = meta.operation === UNDO || meta.operation === REDO;
        if ($$middleware.length) {
          var _ret = function () {
            var middleware = void 0,
                _getNext = void 0,
                exports = {};

            middleware = $$middleware.map(function (m) {
              return m;
            });
            _getNext = function getNext(i) {
              return function (payload_n) {
                var n = i + 1;
                if (!isPlainObject(payload_n)) throw new InvalidReturnError();
                if (middleware[n]) return middleware[n](function () {
                  return payload_n;
                }, _getNext(n), clone(meta), exports);
              };
            };

            if (isRevision)
              // just pass the transformed state thru as the final fn in middleware
              middleware.push(function (prev, next, meta) {
                return next(prev());
              });else
              // final function of the middleware stack is to apply a state update
              middleware.push(pushState);

            return {
              v: function v(payload_0) {
                return middleware[0](function () {
                  return reducerInvoke(payload_0);
                }, _getNext(0), clone(meta));
              }
            };
          }();

          if ((typeof _ret === "undefined" ? "undefined" : _typeof(_ret)) === "object") return _ret.v;
        } else {
          if (isRevision) return reducerInvoke;else return function (payload_0) {
            return pushState(function () {
              return reducerInvoke(payload_0);
            }, 1, clone(meta));
          };
        }
      }

      /**
      * @name pushState
      * @desc function with middleware signature called as the last middleware
      * in the stack to create a new state in history
      * @private
      * @returns {object} - the most current state in history
      */
      function pushState(getDelta, noop, meta) {
        var delta = void 0,
            lastState = void 0,
            nextState = void 0;

        delta = getDelta();
        if (!isPlainObject(delta)) throw new InvalidReturnError();

        lastState = $$history.get($$index).$state;
        nextState = lastState.mergeDeepWith(merger, delta);
        // add a new state to the $$history and increment index
        // return state to the next reducer
        if (!lastState.equals(nextState)) {
          // remove any history past current index
          $$history = $$history.slice(0, $$index + 1);

          var entry = {
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
          if (meta.operation === CANCEL) undo($$index, meta.guid);
        }

        return currentState();
      }

      function undo(atIndex, guid) {
        // ensure that the history being undone is actually the state that this action created
        // if the history was rewound, branched, or replaced, this action no longer affects the stack
        // and an undo could break the history stack in unpredicatable ways
        var entry = $$history.get(atIndex);
        if (entry && entry.guid === guid && !entry.reverted) {
          var lastEntry = $$history.get(atIndex - 1);
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

      function queueUndo(atIndex, guid) {
        if (undo(atIndex, guid))
          // revise subsequent history entries according to revised state at index
          queueHistoryRevision(atIndex);
      }

      function redo(atIndex, guid) {
        // ensure that we're in the correct history tree, as above in `undo`
        var entry = $$history.get(atIndex);
        if (entry && entry.guid === guid && entry.reverted) {
          $$history = $$history.set(atIndex, entry.original);
          return true;
        } else {
          return false;
        }
      }

      function queueRedo(atIndex, guid) {
        if (redo(atIndex, guid))
          // revise subsequent history entries according to revised state at index
          queueHistoryRevision(atIndex);
      }

      function queueHistoryRevision(fromIndex) {
        pendingRevisions.push(fromIndex);
        queueReduceCycle();
      }

      function reviseHistory(fromIndex) {
        $$history.toSeq().slice(fromIndex).reduce(function (prevEntry, entry, i) {
          var reducers = $$reducers.toJS(),
              reducer = reducers[entry.reducerInvoked],
              prevState = prevEntry.$state.toJS(),
              reducerInvoke = function reducerInvoke(payload_0) {
            return reducer.invoke(prevState, payload_0);
          },
              originalReducer = void 0;

          if (entry.reverted) {
            originalReducer = reducers[entry.original.reducerInvoked];
          } else {
            originalReducer = reducer;
          }

          // mimic resolveRequest for the middleware
          var meta = {
            action_name: originalReducer.actionName,
            guid: entry.guid,
            index: fromIndex + i,
            last_state: JSON.stringify(prevState),
            operation: entry.reverted ? UNDO : REDO,
            payload: entry.payload,
            reducer_position: originalReducer.position
          };

          var revisedDelta = applyMiddleware(reducerInvoke, meta)(entry.payload);

          // mimic the merge in pushState, but don't create a new entry
          entry.$state = prevEntry.$state.mergeDeepWith(merger, revisedDelta);
          $$history = $$history.set(fromIndex + i, entry);
          return entry;
        }, $$history.get(fromIndex - 1));
      }

      function updatePendingReducer(atIndex, requestToken, config) {
        // cancel the action request if it is pending
        $$reducers = $$reducers.update(atIndex, function (reducer) {
          var pIndex = reducer.requests.findIndex(function (r) {
            return r.token === requestToken;
          });
          if (pIndex >= 0) reducer.requests[pIndex].canceled = config.canceled;
          return reducer;
        });
      }

      var triggerAction = Symbol("trigger action");
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

      function listenToAction(action, reducerFn, strategy) {
        var actionType = action.$$type;

        if (!reducerFn) throw new InvalidReducerError();

        if (actionType !== ACTION) throw new InvalidActionError();

        var position = $$reducers.size;

        var reducer = {
          actionName: action.$$name,
          invoke: function invoke(lastState, payload, auditRecord, token) {
            if (auditRecord && token)
              // only record invocation if not a revision
              action.didInvoke(token, auditRecord);
            return reducerFn(lastState, payload);
          },
          position: position,
          requests: [],
          strategy: strategy || "TAIL"
        };

        // only add each Action once
        if (!$$reducers.contains(reducer)) {
          $$reducers = $$reducers.push(reducer);

          // kick off a reduce cycle when the reducer action is called anywhere in the app
          action.onTrigger(function (request) {
            return queueReduceCycle(position, request.token, request.payload);
          });

          action.onUndo(function (token, auditRecords) {
            // cancel invocation request if pending
            updatePendingReducer(position, token, { canceled: true });

            // if not pending, then an action alters history and it will have
            // sent an audit record to the Action to cache by its callCount token.
            // Actions may be listened to by multiple state containers, and may
            // therefore have multiple audit records attached to each call.
            // However, THIS state container should only evaluate an undo when the guid
            // of the audit record matches the index of the state it changed,
            // AND the container_id of the audit record matches this container's
            // container_id so we can count on it to undo the correct state transformation.
            var auditRecord = auditRecords.find(function (ar) {
              return ar.$$container_id === $$container_id;
            });
            auditRecord && queueUndo(auditRecord.$$index, auditRecord.guid);
          });

          action.onRedo(function (token, auditRecords) {
            // resume normal workflow for undone but still pending reduce request
            updatePendingReducer(position, token, { canceled: false });
            // see above for iteration reasoning
            var auditRecord = auditRecords.find(function (ar) {
              return ar.$$container_id === $$container_id;
            });
            auditRecord && queueRedo(auditRecord.$$index, auditRecord.guid);
          });

          action.onCancel(function (token) {
            updatePendingReducer(position, token, { canceled: true });
          });
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
      * @memberof StateContainer
      */
      this.when = function when(action, reducer, strategy) {
        if (isFunction(action)) {
          listenToAction(action, reducer, strategy);
        } else if (isArray(action)) {
          action.forEach(function (o) {
            if (isPlainObject(o)) {
              listenToAction(o.action, o.reducer, o.strategy);
            }
          });
        }
        return this;
      };

      // set the store's first reducer as a noop
      // we use this action/reducer when a state has been reverted so it gets
      // so it gets passed through on subsequent revisions further back in the stack
      this.when(new Action('noop'), function (lastState) {
        return lastState;
      });

      // set a second reducer to handle direct setState operations
      var setStateAction = new Action("setState");
      var setStateReducer = function setStateReducer(lastState, deltaMap) {
        return merge({}, lastState, deltaMap);
      };
      this.when(setStateAction, setStateReducer, Action.strategies.COMPOUND);

      // set a third reducer that entirely replaces the state with a new state
      var replaceStateAction = new Action('replaceState');
      var replaceStateReducer = function replaceStateReducer(lastState, newState) {
        return Immutable.Seq(lastState).reduce(function (acc, val, key) {
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
      * @memberof StateContainer
      */
      this.setState = function setState(deltaMap) {
        if (!isPlainObject(deltaMap)) {
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
      * @memberof StateContainer
      */
      this.replaceState = function replaceState(newState) {
        if (!isPlainObject(newState)) {
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
      * @memberof StateContainer
      * @fires STATE_CHANGE
      */
      this.reset = function reset(hard) {
        if (hard === true) {
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
      * @desc reset the StateContainer's history to an index. DESTRUCTIVE! Deletes history past index.
      * @param {int} index - what state to move the history to
      * @method
      * @instance
      * @memberof StateContainer
      * @fires STATE_CHANGE
      */
      this.revert = function revert(index) {
        if (!Number.isInteger(index)) {
          throw new InvalidIndexError();
        } else if (index >= 0 && index <= $$history.size - 1) {
          $$index = index;
          $$history = $$history.slice(0, $$index + 1);
          trigger();
        }
      };

      /**
      *
      * @name fastForward
      * @desc move the StateContainer's history index ahead `n` frames. Does not alter history.
      * @param {int} n=1 - how many frames to fast forward. Cannot fast forward past the last frame.
      * @method
      * @instance
      * @memberof StateContainer
      * @fires STATE_CHANGE
      */
      this.fastForward = function fastForward(n) {
        if (n !== undefined && !Number.isInteger(n)) {
          throw new InvalidIndexError();
        } else {
          n = n || 1;
          // ensure we don't go past the end of history
          $$index = Math.min($$index + Math.abs(n), $$history.size - 1);
          trigger();
        }
      };

      /**
      *
      * @name rewind
      * @desc move the StateContainer's history index back `n` frames. Does not alter history.
      * @param {int} n=1 - how many frames to rewind. Cannot rewind past 0.
      * @method
      * @instance
      * @memberof StateContainer
      * @fires STATE_CHANGE
      */
      this.rewind = function rewind(n) {
        if (n !== undefined && !Number.isInteger(n)) {
          throw new InvalidIndexError();
        } else {
          n = n || 1;
          // ensure we don't go past the beginning of time
          $$index = Math.max($$index - Math.abs(n), 0);
          trigger();
        }
      };

      /**
      *
      * @name goto
      * @desc move the StateContainer's history index to `index`. Does not alter history.
      * @param {int} index - the index to move to
      * @method
      * @instance
      * @memberof StateContainer
      * @fires STATE_CHANGE
      */
      this.goto = function goto(index) {
        if (!Number.isInteger(index)) {
          throw new InvalidIndexError();
        } else if (index >= 0 && index <= $$history.size - 1) {
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
    * @memberof StateContainer
    * @returns {Immutable.Map}
    */


    _createClass(StateContainer, [{
      key: "getImmutableState",
      value: function getImmutableState() {
        return Immutable.Map(this.history[this.index].$state);
      }

      /**
      *
      * @name getInitialState
      * @desc Get the initial app state that was passed to the constructor
      * @method
      * @instance
      * @memberof StateContainer
      * @returns {object} state
      */

    }, {
      key: "getInitialState",
      value: function getInitialState() {
        return this.history[0].$state.toJS();
      }

      /**
      *
      * @name getState
      * @desc Get the app's state at a version in history
      * @param {int} [index=current]
      * @method
      * @instance
      * @memberof StateContainer
      * @returns {object} state
      */

    }, {
      key: "getState",
      value: function getState(index) {
        if (index === undefined) index = this.index;
        if (this.history[index]) return this.history[index].$state.toJS();
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
      * @memberof StateContainer
      */

    }, {
      key: "onchange",
      value: function onchange(listener, thisBinding) {
        return this._emitter.on(STATE_CHANGE, listener, thisBinding);
      }
    }, {
      key: "addListener",
      value: function addListener(listener, thisBinding) {
        return this.onchange(listener, thisBinding);
      }

      /**
      * @name trigger
      * @desc trigger all listeners with the current state and last state
      * @method
      * @instance
      * @fires STATE_CHANGE
      * @memberof StateContainer
      */

    }, {
      key: "trigger",
      value: function trigger() {
        this._emitter.emit(STATE_CHANGE, this.state, this.getState(this.index - 1));
      }
    }], [{
      key: "errors",
      get: function get() {
        return {
          INVALID_DELTA: InvalidDeltaError,
          INVALID_RETURN: InvalidReturnError,
          INVALID_REDUCER: InvalidReducerError,
          INVALID_INDEX: InvalidIndexError
        };
      }
    }]);

    return StateContainer;
  }();

  // polyfill
  Number.isInteger = Number.isInteger || function (value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  };
};