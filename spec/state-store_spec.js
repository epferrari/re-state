"use-strict";

import EventEmitter from 'events';
import Immutable from 'immutable';
import _ from 'lodash';


import ReducerFactory from '../src/reducer-factory';
import HookFactory from '../src/hook-factory';
import StateStoreFactory from '../src/store-factory';



describe("State Store Factory", () => {
  var StateStore, Reducer, Hook, store, tick;

  beforeEach(() => {
    StateStore = StateStoreFactory(Immutable, EventEmitter, _);
    Reducer = ReducerFactory(EventEmitter);
    Hook = HookFactory();
    jasmine.clock().install()

    tick = (cb) => setTimeout(cb, 0);

  });

  afterEach(jasmine.clock().uninstall)

  describe("constructor", () => {
    it("initializes with an `immutable` state", () => {
      store = new StateStore({
        rabbit: "MQ"
      });
      expect(() => {
        return store.state = {
          rabbit: "stew"
        };
      }).toThrow();
      expect(store.state.rabbit).toEqual("MQ");
    });

    it("initializes with an `immutable` emitter property", () => {
      store = new StateStore();
      expect(store.emitter).toBeDefined();
      expect(() => {
        return store.emitter = true;
      }).toThrow();
    });

    it("initializes with an immutable `reducers` property", () => {
      store = new StateStore();
      expect(store.reducers).toBeDefined();
      expect( () => { store.reducers = []} ).toThrow();
    });

    it("adds an initial reducer",() => {
      store = new StateStore();
      expect(store.reducers.length).toEqual(1);
    });

    describe("when called with no arguments", () => {
      it("initializes an empty state object", () => {
        store = new StateStore();
        expect(store.state).toEqual({});
      });
    });

    describe("when called with an object argument", () => {
      it("initializes with an initial state", () => {
        store = new StateStore({
          rabbit: "MQ"
        });
        return expect(store.state).toEqual({
          rabbit: "MQ"
        });
      });
    });

    describe("when initialized with a non-object initial state", () => {
      it("throws an error", () => {
        let storeCreator = () => {
          return new StateStore("Roger Rabbit");
        };
        expect(storeCreator).toThrow(new Error(StateStore.errors.INVALID_DELTA) );
      });
    });
  });

  describe("setState()", () => {
    var stateSetter;
    beforeEach(() => {
      store = new StateStore();
      stateSetter = store.reducers[0];
      spyOn(stateSetter, '$invoke').and.callThrough();

    });

    it("defers setting state until next tick", () => {
      expect(store.state).toEqual({});

      store.setState({ rabbit: "MQ" });

      expect(stateSetter.$invoke).not.toHaveBeenCalled();
      expect(store.state).toEqual({});

      jasmine.clock().tick(0)

      expect(stateSetter.$invoke).toHaveBeenCalled();
      expect(store.state).toEqual({ rabbit: "MQ" });
    });

    describe("when called with a non-object delta", () => {
      it("setState throws an error", () => {
        let setter;

        setter = () => {
          store.setState("egg basket");
          jasmine.clock().tick(0)
        };
        expect(setter).toThrow(new Error(StateStore.errors.INVALID_DELTA));

        setter = () => {
          store.setState(1);
          jasmine.clock().tick(0)
        };
        expect(setter).toThrow(new Error(StateStore.errors.INVALID_DELTA));

        setter = () => {
          store.setState(true);
          jasmine.clock().tick(0)
        };
        expect(setter).toThrow(new Error(StateStore.errors.INVALID_DELTA));

        setter = () => {
          store.setState(() => true)
          jasmine.clock().tick(0)
        }
        expect(setter).toThrow(new Error(StateStore.errors.INVALID_DELTA));
      });
    });

    describe("consolidating state updates", () => {
      beforeEach(() => {
        spyOn(store, 'trigger');
        expect(store.state).toEqual({});

        store.setState({ rabbit: "MQ" });
        store.setState({ rabbit: "stew" });
        store.setState({ rabbit: "foot" });
        store.setState({ rabbit: "Roger" });
      });

      it("consolidates state updates until the callstack clears", () => {
        expect(store.state).toEqual({});
        jasmine.clock().tick(0);
        expect(store.state).toEqual({ rabbit: "Roger" });
      });

      it("only calls trigger once per tick", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        jasmine.clock().tick(0);
        expect(store.trigger).toHaveBeenCalledTimes(1);
      });

      it("does not call trigger if the state has not changed 1", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        jasmine.clock().tick(0);
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();
        store.setState(store.state);
        jasmine.clock().tick(0);
        expect(store.trigger).not.toHaveBeenCalled();
      });

      it("does not call trigger if the state has not changed 2", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        jasmine.clock().tick(0);
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();
        store.setState({rabbit: "Roger"});
        jasmine.clock().tick(0);
        expect(store.trigger).not.toHaveBeenCalled();
      });
    });

    describe("when the changes to state are nested deeply", () => {
      let rabbit1, rabbit2;

      beforeEach(() => {
        rabbit1 = {
          name: "Peter Cottontail",
          home: {
            city: "McGregor's garden"
          }};
        rabbit2 = {
          name: "Frank",
          home: {
            city: "Middlesex",
            state: "VA"
          }};

        store = new StateStore( {rabbits: [rabbit1, rabbit2]} );
      });

      it("changes the nested state and calls trigger", () => {
        let rabbit1_b = _.clone(rabbit1);
        rabbit1_b.home.state = "Connecticut";
        store.setState({
          rabbits: [ rabbit1_b, rabbit2 ]
        });
        jasmine.clock().tick(0);
        expect(store.state.rabbits[0].home.state).toBe("Connecticut");
        expect(store.state.rabbits[1]).toBeDefined();
      });

      it("merges multiple changes to the same object", () => {
        let rabbit1_b = _.merge({}, rabbit1);
        let rabbit1_c = _.merge({}, rabbit1);

        rabbit1_b.home.state = "Connecticut";
        expect(rabbit1_b).not.toEqual(rabbit1);

        store.setState({
          rabbits: [ rabbit1_b, rabbit2 ]
        });

        rabbit1_c.home.city = "Hartford";
        expect(rabbit1_c).not.toEqual(rabbit1_b);

        store.setState({
          rabbits: [rabbit1_c, rabbit2]
        });

        let lastStateRabbit1 = store.state.rabbits[0];
        expect(lastStateRabbit1.home.state).toBeUndefined();
        expect(lastStateRabbit1.home.city).toBe("McGregor's garden");

        jasmine.clock().tick(0);

        let newStateRabbit1 = store.state.rabbits[0];
        expect(newStateRabbit1.home.state).toBe("Connecticut");
        expect(newStateRabbit1.home.city).toBe("Hartford");
      });
    });
  });


  describe("getInitialState()", () =>{
    beforeEach(() =>{
      store = new StateStore({rabbit: "MQ"});
    });

    it("returns the initial data state", () =>{
      expect(store.getInitialState()).toEqual({rabbit: "MQ"});

      store.setState({rabbit: "Roger"});
      jasmine.clock().tick(0)

      expect(store.state.rabbit).toBe("Roger");
      expect(store.getInitialState()).toEqual({rabbit: "MQ"});
    });
  });


  describe("listenTo()", () => {
    let addItem, removeItem, clearCart, updatePrice, checkout;

    beforeEach(() => {
      store = new StateStore({
        items: [],
        priceList: {0: .25, 1: .50, 2: .75}
      });

      let getItemIndex = (id, items) => {
        _.findIndex(items, item => {
          return item.id === id;
        });
      };

      let getPrice = (id) => store.state.priceList[id] || 0

      addItem = new Reducer('addItem', (lastState, deltaMap) => {
        let {items} = lastState;
        let itemIndex = getItemIndex(deltaMap.id, items);
        let existingItem = items[itemIndex];
        if(existingItem){
          existingItem.qty++
          items[itemIndex] = existingItem;
        }else{
          items.push({
            id: deltaMap.id,
            qty: 1
          });
        }

        return {items: items};
      });

      removeItem = new Reducer('removeItem', (lastState, deltaMap) => {
        let {items} = lastState;
        let itemIndex = getItemIndex(deltaMap.id, items);
        let item = items[itemIndex];
        if(item){
          item.qty--;
          item.qty = Math.max(item.qty, 0)
          items[itemIndex] = item;
        }
        return {items: items};
      });

      updatePrice = new Reducer('updatePrice', (lastState, deltaMap) => {
        let {priceList} = lastState.priceList;
        priceList[deltaMap.id] = deltaMap.price;
        return {priceList: priceList};
      });

      clearCart = new Reducer('clearCart', (lastState, deltaMap) => {
        let {items} = lastState;
        items = _.map(items, item => {
          item.qty = 0;
          return item;
        });
        return {items: items};
      });

      checkout = new Reducer('checkout', (lastState, deltaMap) => {
        let total = lastState.items.reduce((subTotal, item) => {
          return subTotal + (getPrice(item.id) * item.qty);
        }, 0)
        return {total: total}
      });
    });

    describe("tail strategy", () => {
      beforeEach(() => {
        store.listenTo(addItem, "tail");
      });

      it("updates the state from the last call to reducer", () => {
        expect(store.state.items).toEqual([]);
        addItem({id: 0});
        addItem({id: 2});
        addItem({id: 1});

        jasmine.clock().tick(0);
        expect(store.state.items).toEqual([{id: 1, qty: 1}]);

      });
    });
  });
  /*
  describe("addListener()", () => {
    var cb;
    cb = void 0;
    beforeEach(() => {
      store = new StateStore({
        rabbit: "Benjamin"
      });
      return cb = jasmine.createSpy();
    });
    it("calls the listener immediately with current state", () => {
      store.addListener(cb);
      return expect(cb).toHaveBeenCalledWith({
        rabbit: "Benjamin"
      });
    });
    return it("calls the listener when the state updates", () => {
      store.addListener(cb);
      cb.calls.reset();
      store.setState({
        ears: "floppy",
        tail: "cotton"
      });
      tick();
      return expect(cb).toHaveBeenCalledWith({
        rabbit: "Benjamin",
        ears: "floppy",
        tail: "cotton"
      });
    });
  });
  describe("trigger()", () => {
    var cb;
    cb = void 0;
    beforeEach(() => {
      store = new StateStore({
        rabbit: "Benjamin"
      });
      cb = jasmine.createSpy();
      store.addListener(cb);
      return cb.calls.reset();
    });
    return it("notifies listeners with the current state", () => {
      expect(cb).not.toHaveBeenCalled();
      store.trigger();
      return expect(cb).toHaveBeenCalledWith({
        rabbit: "Benjamin"
      });
    });
  });
  return describe("addReducer()", () => {
    var storeListener;
    storeListener = void 0;
    beforeEach(() => {
      store = new StateStore({
        rabbit: "Benjamin"
      });
      storeListener = jasmine.createSpy();
      store.addListener(storeListener);
      storeListener.calls.reset();
      return spyOn(store, 'trigger');
    });
    it("reduces a new state from a reducer function", () => {
      var reducer, reducerFn;
      reducerFn = function(lastState, newState) {
        return {
          rabbit: newState.rabbit
        };
      };
      reducer = new Reducer(reducerFn);
      store.addReducer(reducer);
      reducer({
        rabbit: "Jack"
      });
      tick();
      expect(store.trigger).toHaveBeenCalledTimes(1);
      return expect(store.state).toEqual({
        rabbit: "Jack"
      });
    });
    it("passes the current state into the reducer", () => {
      var newState, obj, origState, reducer;
      origState = _.clone(store.state);
      newState = {
        rabbit: "Bunny"
      };
      obj = {
        reducerFn: function(lastState, newState) {
          return {
            rabbit: lastState.rabbit + " " + newState.rabbit
          };
        }
      };
      spyOn(obj, 'reducerFn').and.callThrough();
      reducer = new Reducer(obj.reducerFn);
      store.addReducer(reducer);
      reducer(newState);
      tick();
      expect(obj.reducerFn).toHaveBeenCalledTimes(1);
      return expect(store.state.rabbit).toEqual("Benjamin Bunny");
    });
    return describe("when there are multiple reducers called", () => {
      var reducer1, reducer2, reducer3;
      reducer1 = reducer2 = reducer3 = void 0;
      beforeEach(() => {
        var reducerFn1, reducerFn2, reducerFn3;
        reducerFn1 = function(lastState, update) {
          return {
            rabbit: update
          };
        };
        reducerFn2 = function(lastState, update) {
          return {
            rabbit: lastState.rabbit + " " + update.lastName
          };
        };
        reducerFn3 = function(lastState, newState) {
          return {
            phrase: "Here comes " + lastState.rabbit
          };
        };
        reducer1 = new Reducer(reducerFn1);
        reducer2 = new Reducer(reducerFn2);
        reducer3 = new Reducer(reducerFn3);
        store.addReducer(reducer1);
        store.addReducer(reducer2);
        return store.addReducer(reducer3);
      });
      it("reduces a new state by multiple reducers in order the reducers were called", () => {
        expect(store.state.rabbit).toEqual('Benjamin');
        reducer1("Peter");
        reducer2({
          lastName: "Cottontail"
        });
        reducer3();
        tick();
        expect(store.state.rabbit).toEqual("Peter Cottontail");
        return expect(store.state.phrase).toEqual("Here comes Peter Cottontail");
      });
      return it("only reduces state with the reducers called during each tick", () => {
        expect(store.state.rabbit).toEqual('Benjamin');
        reducer1("Roger");
        tick();
        expect(store.state.rabbit).toEqual("Roger");
        expect(store.state.phrase).toBeUndefined();
        reducer1("Peter");
        reducer2({
          lastName: "Cottontail"
        });
        reducer3();
        tick();
        expect(store.state.rabbit).toEqual("Peter Cottontail");
        expect(store.state.phrase).toEqual("Here comes Peter Cottontail");
        reducer1("Benjamin");
        reducer2({
          lastName: "Bunny"
        });
        tick();
        expect(store.state.rabbit).toEqual("Benjamin Bunny");
        return expect(store.state.phrase).toEqual("Here comes Peter Cottontail");
      });
    });
  });
  */
});
