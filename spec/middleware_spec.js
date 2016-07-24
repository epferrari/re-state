"use-strict";

import {Store, Action} from '../src';
import _ from 'lodash';


describe("middleware", () => {

  let store, mw,
      callOrder,
      log,
      caughtExceptions,
      addItem,
      addExtraProps;

  beforeEach(() => {
    jasmine.clock().install();

    callOrder = [],
    log = [],
    caughtExceptions = [],

    // create some actions

    addItem = new Action('addItem', (lastState, id) => {
      let {cart} = lastState;
      let itemIndex = _.findIndex(cart, (item) => item.id === id);

      if(itemIndex !== -1)
        cart[itemIndex].qty++;
      else
        cart.push({id, qty: 1});

      return {cart};
    });

    addExtraProps = new Action('addExtraProps', (lastState, payload) => {
      return payload;
    });


    // create some middleware

    function exceptionHandler(prev, next, meta){
      callOrder.push('exceptionHandler')
      try {
        return next(prev())
      } catch(ex){
        caughtExceptions.push(ex)
      }
    }


    function pruner(prev, next, meta){
      callOrder.push('pruner')
      return next(_.pick(prev(), ['cart', 'total']))
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

    store.listenTo([
      {action: addItem, strategy: 'compound'},
      addExtraProps
    ]);
  });


  afterEach(() => jasmine.clock().uninstall());

  describe("calling middleware", () => {
    beforeEach(() => {
      addItem("01")
    })

    it("is called in the order the middleware was added to the store", () => {
      jasmine.clock().tick(0)
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

      jasmine.clock().tick(0)

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

    jasmine.clock().tick(0)
    // expecting that the key 'something' got pruned before adding to history state
    expect(store.state.something).toBeUndefined()
  });

  describe("handling exceptions with middleware", () => {
    beforeEach(() => {
      spyOn(store, 'trigger');
      store.trigger.calls.reset();
      expect(caughtExceptions.length).toEqual(0);
    });

    it("can catch errors thrown inside actions", () => {
      let actionThatThrows = new Action('actionThatThrows', (lastState, payload) => {
        throw new Error('something went awry')
      });

      store.listenTo(actionThatThrows)
      actionThatThrows()

      jasmine.clock().tick(0)
      expect(caughtExceptions.length).toEqual(1)
      expect(store.trigger).not.toHaveBeenCalled()
    });

    it("can catch an error raised by a poorly written action which doesn't return an object literal", () => {
      // returns a string instead of a delta oject
      let poorlyWrittenAction = new Action('poorlyWrittenAction', (lastState, id) => {
        return "elephant";
      });

      store.listenTo(poorlyWrittenAction)

      poorlyWrittenAction();
      jasmine.clock().tick(0);

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

      otherStore.listenTo(addItem);

      spyOn(otherStore, 'trigger');
      otherStore.trigger.calls.reset();

      expect(caughtExceptions.length).toEqual(0)
      addItem("O1");

      jasmine.clock().tick(0)
      expect(caughtExceptions.length).toEqual(1)
      expect(otherStore.trigger).not.toHaveBeenCalled()
    });
  });
});
