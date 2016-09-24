"use-strict";

import {Store, Action} from '../src';
import _ from 'lodash';


describe("middleware", () => {

  let store,
      mw,
      tick,
      callOrder,
      log,
      caughtExceptions,
      addItem, handleAddItem,
      addExtraProps, handleExtraProps;

  beforeEach(() => {
    jasmine.clock().install();

    tick = n => jasmine.clock().tick(n || 0);

    callOrder = [];
    log = [];
    caughtExceptions = [];

    // create some actions

    addItem = new Action('addItem');
    addExtraProps = new Action('addExtraProps');

    handleAddItem = (lastState, id) => {
      let {cart} = lastState;
      let itemIndex = _.findIndex(cart, (item) => item.id === id);

      if(itemIndex !== -1)
        cart[itemIndex].qty++;
      else
        cart.push({id, qty: 1});

      return {cart};
    };


    handleExtraProps = (lastState, payload) => payload;


    // create some middleware

    function exceptionHandler(prev, next, meta){
      callOrder.push('exceptionHandler')
      try {
        return next(prev());
      } catch(ex){
        caughtExceptions.push(ex);
      }
    }


    function pruner(prev, next, meta){
      callOrder.push('pruner');
      return next(_.pick(prev(), ['cart', 'total']));
    }

    function logger(prev, next, meta){
      callOrder.push('logger');
      log.push(meta)
      return next(prev());
    }

    function totaller(prev, next, meta){
      callOrder.push('totaller');

      let prices = {
        "01": 0.50,
        "02": 0.75,
        "03": 1.25
      };
      let delta = prev();
      let {cart} = delta;

      if(cart){
        delta.total = cart.reduce((total, item) => {
          return total + (item.qty * prices[item.id]);
        }, 0);
      }
      return next(delta);
    }

    mw = {exceptionHandler, logger, pruner, totaller}

    spyOn(mw, "exceptionHandler").and.callThrough()
    spyOn(mw, "logger").and.callThrough()
    spyOn(mw, "pruner").and.callThrough()
    spyOn(mw, "totaller").and.callThrough()

    // finally set up store with actions and middleware

    store = new Store(
      {cart: [], total: 0},
      _.map(mw, fn => fn)
    );

    store.when([
      {action: addItem, reducer: handleAddItem, strategy: 'compound'},
      {action: addExtraProps, reducer: handleExtraProps}
    ]);
  });


  afterEach(() => jasmine.clock().uninstall());

  describe("calling middleware", () => {
    beforeEach(() => {
      addItem("01")
    })

    it("is called in the order the middleware was added to the store", () => {
      tick()
      expect(callOrder).toEqual([
        "exceptionHandler",
        "logger",
        "pruner",
        "totaller"
      ])
    })
  });

  describe("when there are multiple actions invoked", () => {
    it("gets called for every action that will update state history", ()=> {
      addItem("01")
      addItem("01")
      addItem("03")

      tick()

      expect(store.state).toEqual({
        cart:[
          {id: "01", qty: 2},
          {id: "03", qty: 1}
        ],
        total: 2.25
      })

    })
  })


  it("operates on the new state before it gets merged into history", () => {
    addExtraProps({something: 'else'});

    tick()
    // expecting that the key 'something' got pruned before adding to history state
    expect(store.state.something).toBeUndefined()
  });

  it("receives meta data about action invocations", () => {
    addItem(0);
    addItem(0);
    addItem(1);
    addItem(2);
    tick();

    // logger middleware pushes meta to log array
    expect(log[0]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 1,
      operation: "RESOLVE",
      payload: 0
    }));

    expect(log[3]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 4,
      operation: "RESOLVE",
      payload: 2
    }));
  });

  it("receives meta data about actions that are undone/redone", () => {
    let undoAdd = addItem(1);
    tick();

    expect(log.length).toBe(1);
    let redoAdd = undoAdd();
    tick();

    expect(log.length).toBe(2);
    expect(log[1]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 1,
      operation: "UNDO",
      payload: {}
    }));

    redoAdd();
    tick();

    expect(log.length).toBe(3);
    expect(log[2]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 1,
      operation: "REDO",
      payload: 1
    }));
  });

  it('receives meta data about actions that are canceled', () => {
    let undoAdd = addItem(0);
    undoAdd();

    tick();
    expect(log.length).toBe(1);
    expect(log[0]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 1,
      operation: "CANCEL",
      payload: 0
    }));

    // invoke, undo, redo
    addItem(1)()();
    // history entry wasn't written yet, so it should resolve as usual
    tick();
    expect(log.length).toBe(2);
    expect(log[1]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 2,
      operation: "RESOLVE",
      payload: 1
    }));

    // invoke and undo
    let redoAdd = addItem(2)();
    tick();
    expect(log.length).toBe(3);

    redoAdd();
    tick();
    expect(log.length).toBe(4);
    expect(log[3]).toEqual(jasmine.objectContaining({
      action_name: 'addItem',
      index: 3,
      operation: 'REDO',
      payload: 2
    }));
  });

  it("throws an error when an action is called from inside middleware", () => {
    let impureMiddleware = (prev, next, meta) => {
      addItem(0);
      next(prev());
    }

    let store2 = new Store({}, [impureMiddleware])
    store2.when(addItem, handleAddItem)

    addItem(1);
    expect(tick).toThrow()
  })

  describe("handling exceptions with middleware", () => {
    beforeEach(() => {
      spyOn(store, 'trigger');
      store.trigger.calls.reset();
      expect(caughtExceptions.length).toEqual(0);
    });

    it("can catch errors thrown inside actions", () => {
      let actionX = new Action('actionX');
      let reducerThatThrows = lastState => {throw new Error('something went awry')}

      store.when(actionX, reducerThatThrows)
      actionX()

      tick()
      expect(caughtExceptions.length).toEqual(1)
      expect(store.trigger).not.toHaveBeenCalled()
    });

    it("can catch an error raised by a poorly written action which doesn't return an object literal", () => {
      // returns a string instead of a delta oject
      let actionY = new Action('actionY');
      let poorlyWrittenReducer = lastState => "elephant";

      store.when(actionY, poorlyWrittenReducer);

      actionY();
      tick();

      expect(caughtExceptions.length).toEqual(1)
      expect(store.trigger).not.toHaveBeenCalled()
    });

    it("can catch an error raised by a poorly written middleware downstream", () => {
      mw.poorlyWrittenMiddleware = (next, prev, meta) => {
        next(prev())
        return "not an object literal";
      }


      let otherStore = new Store(
        {cart: [], total: 0},
        [mw.exceptionHandler, mw.poorlyWrittenMiddleware]
      )

      otherStore.when(addItem, handleAddItem);

      spyOn(otherStore, 'trigger');
      otherStore.trigger.calls.reset();

      expect(caughtExceptions.length).toEqual(0)
      addItem("O1");

      tick()
      expect(caughtExceptions.length).toEqual(1)
      expect(otherStore.trigger).not.toHaveBeenCalled()
    });
  });
});
