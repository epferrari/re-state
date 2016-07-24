"use-strict";

import Promise from 'bluebird';
import {Store, Action} from '../src/apheleia';
import _ from 'lodash';

/*
describe("middleware", () => {

  let mw,
      callOrder = [],
      log = [],
      caughtExceptions = [],
      addItem,
      addExtraProps;

  beforeEach(() => {
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

    function handleExceptions(prev, next, meta){
      callOrder.push('handleExceptions')
      try {
        return next(prev())
      } catch(ex){
        caughtExceptions.push(ex)
      }
    }

    function handleAsyncActions(prev, next, meta){
      callOrder.push("handleAsyncActions")
      let delta = prev()
      if(typeof delta.then === 'function'){
        return delta.then(next)
      }else{
        return next(delta)
      }
    }

    function prune(prev, next, meta){
      callOrder.push('prune')
      return next(_.pick(prev(), ['cart', 'total']))
    }

    function logMeta(prev, next, meta){
      callOrder.push('logMeta');
      log.push(meta)
      return next(prev());
    }

    function calculateTotal(prev, next, meta){
      callOrder.push('calculateTotal');

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


  beforeEach(() => {
    caughtExceptions = [];
    log = [];
    callOrder = [];

    mw = {handleExceptions, handleAsyncActions, logMeta, prune, calculateTotal}

    spyOn(mw, "handleExceptions").and.callThrough()
    spyOn(mw, "handleAsyncActions").and.callThrough()
    spyOn(mw, "logMeta").and.callThrough()
    spyOn(mw, "prune").and.callThrough()
    spyOn(mw, "calculateTotal").and.callThrough()
  });

  // set up store with middleware and listening to actions
  beforeEach(() => {
    store = new Store(
      {cart: [], total: 0},
      [mw.handleExceptions, mw.handleAsyncActions, mw.logMeta, mw.prune, mw.calculateTotal]
    );

    store.listenTo([
      {action: addItem, strategy: 'compound'},
      addExtraProps
    ]);

    //jasmine.clock().uninstall()
  });

  afterEach(() => jasmine.clock().install())

  describe("calling middleware", () => {
    beforeEach((done) => {
      addItem("01")
      setTimeout(done,50)
    })

    it("is called in the order the middleware was added to the store", () => {
      console.log('callOrder',callOrder)
      console.log('exceptions', caughtExceptions)
      expect(callOrder).toEqual([
        "handleExceptions",
        "handleAsyncActions",
        "logMeta",
        "prune",
        "calculateTotal"
      ])
    })
  })

  describe("handling an async action", () => {
    let asyncAddItem, resolver, resolved;

    beforeEach((done) => {
      resolved = undefined
      let asyncAddItem = new Action((lastState, payload) => {
        resolved = new Promise((resolve, reject) => {
          // reveal this externally so we can mock the async resolution
          let {cart} = lastState
          // making it simple, just add an item to the cart
          cart.push({id: payload, qty: 1})
          resolver = () => resolve({cart})
        })

        return resolved
      })

      store.listenTo(asyncAddItem)

      asyncAddItem("03")
      setTimeout(done, 25)
    })

    afterEach((done) => {
      setTimeout(() => {
        resolver = resolved = undefined
        done()
      },0)

    })

    it("should delay subsequent middleware exectution until the async action is resolved", (done) => {
      expect(callOrder).toEqual([
        "handleExceptions",
        "handleAsyncActions"
      ])

      resolver()

      let pred = () => {
        return (callOrder == [
          "handleExceptions",
          "handleAsyncActions",
          "logMeta",
          "prune",
          "calculateTotal"
        ])
      }

      let onSuccess = () => {
        expect(callOrder).toEqual([
          "handleExceptions",
          "handleAsyncActions",
          "logMeta",
          "prune",
          "calculateTotal"
        ])
      }
      waitsFor(onSuccess, done, 20)

    })

    it("delays updating the state history until the async action is resolved", (done) => {
      expect(store.state).toEqual({ cart: [], total: 0 })

      resolver()

      resolved.then(() => {
        done()
        expect(store.state).toEqual({ cart: [ { id: '03', qty: 1 } ], total: 1.25 })
      })
    })
  })



  describe("when there are multiple actions invoked", () => {
    it("gets called for every action that will update state history", (done) => {
      addItem("01")
      addItem("01")
      addItem("03")

      setTimeout(() => {
        expect(store.state).toEqual({
          cart:[
            {id: "01", qty: 2},
            {id: "03", qty: 1}
          ],
          total: 2.25
        })
        done()
      }, 50)

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
      mw.poorlyWrittenMiddleware = (next) => {
        next()
        return "not an object literal";
      }


      let otherStore = new Store({cart: [], total: 0}, [mw.handleException, mw.poorlyWrittenMiddleware])

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
*/
