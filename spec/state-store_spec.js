"use-strict";

import {Store, Action} from '../src';
import _ from 'lodash';

describe("State Store", () => {

  var store, tick;

  beforeEach(() => {
    jasmine.clock().install()
    tick = (n) => jasmine.clock().tick(n || 0);
  });

  afterEach(jasmine.clock().uninstall)

  describe("#constructor", () => {
    it("initializes with an `immutable` state", () => {
      store = new Store({
        rabbit: "MQ"
      });
      expect(() => {
        return store.state = {
          rabbit: "stew"
        };
      }).toThrow();
      expect(store.state.rabbit).toEqual("MQ");
    });

    it("initializes with an immutable _emitter property", () => {
      store = new Store();
      expect(store._emitter).toBeDefined();
      expect(() => {
        return store._emitter = true;
      }).toThrow();
    });

    it("initializes with an immutable `reducers` property", () => {
      store = new Store();
      expect(store.reducers).toBeDefined();
      expect( () => { store.reducers = []} ).toThrow();
    });

    it("adds 3 initial reducers, a noOp and a setState, and a replaceState reducer",() => {
      store = new Store();
      expect(store.reducers.length).toEqual(3);
    });

    describe("when called with no arguments", () => {
      it("initializes an empty state object", () => {
        store = new Store();
        expect(store.state).toEqual({});
      });
    });

    describe("when called with an object argument", () => {
      it("initializes with an initial state", () => {
        store = new Store({
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
          return new Store("Roger Rabbit");
        };
        expect(storeCreator).toThrow( new Store.errors.INVALID_DELTA() );
      });
    });
  });

  describe("#setState", () => {
    var stateSetter;
    beforeEach(() => {
      store = new Store();
      stateSetter = store.reducers[1];
      spyOn(stateSetter, 'invoke').and.callThrough();

    });

    it("defers setting state until next tick", () => {
      expect(store.state).toEqual({});

      store.setState({ rabbit: "MQ" });

      expect(stateSetter.invoke).not.toHaveBeenCalled();
      expect(store.state).toEqual({});

      tick()

      expect(stateSetter.invoke).toHaveBeenCalled();
      expect(store.state).toEqual({ rabbit: "MQ" });
    });

    describe("when called with a non-object delta", () => {
      let invalidDeltaError = () => new Store.errors.INVALID_DELTA();

      it("setState throws an error", () => {
        let setter;

        setter = () => {
          store.setState("egg basket");
          tick()
        };
        expect(setter).toThrow( invalidDeltaError() );

        setter = () => {
          store.setState(1);
          tick()
        };
        expect(setter).toThrow( invalidDeltaError() );

        setter = () => {
          store.setState(true);
          tick()
        };
        expect(setter).toThrow( invalidDeltaError() );

        setter = () => {
          store.setState(() => true)
          tick()
        }
        expect(setter).toThrow( invalidDeltaError() );
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
        tick();
        expect(store.state).toEqual({ rabbit: "Roger" });
      });

      it("only calls trigger once per tick", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
      });

      it("does not call trigger if the state has not changed (test 1)", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();
        store.setState(store.state);
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
      });

      it("does not call trigger if the state has not changed (test 2)", () => {
        expect(store.trigger).not.toHaveBeenCalled();
        tick();
        expect(store.trigger).toHaveBeenCalledTimes(1);
        store.trigger.calls.reset();
        store.setState({rabbit: "Roger"});
        tick();
        expect(store.trigger).not.toHaveBeenCalled();
      });
    });

    describe("when the changes to state are nested deeply", () => {
      let rabbit1, rabbit2;

      beforeEach(() => {
        rabbit1 = {
          name: "Peter Cottontail",
          home: {city: "McGregor's garden"}
        };
        rabbit2 = {
          name: "Frank",
          home: {
            city: "Middlesex",
            state: "VA"
          }};

        store = new Store( {rabbits: [rabbit1, rabbit2]} );
      });

      it("changes the nested state and calls trigger", () => {
        let updatedRabbit1 = _.clone(rabbit1);
        updatedRabbit1.home.state = "Connecticut";
        store.setState({
          rabbits: [ updatedRabbit1, rabbit2 ]
        });
        tick();
        expect(store.state.rabbits[0].home.state).toBe("Connecticut");
        expect(store.state.rabbits[1]).toBeDefined();
      });

      it("merges multiple changes to the same object", () => {
        let rabbit1_1 = _.merge({}, rabbit1);
        let rabbit1_2 = _.merge({}, rabbit1);

        rabbit1_1.home.state = "Connecticut";
        expect(rabbit1_1).not.toEqual(rabbit1);

        store.setState({
          rabbits: [ rabbit1_1, rabbit2 ]
        });

        rabbit1_2.home.city = "Hartford";
        expect(rabbit1_2).not.toEqual(rabbit1_1);

        store.setState({
          rabbits: [rabbit1_2, rabbit2]
        });

        let lastState_rabbit1 = store.state.rabbits[0];
        expect(lastState_rabbit1.home.state).toBeUndefined();
        expect(lastState_rabbit1.home.city).toBe("McGregor's garden");

        tick();

        let newState_rabbit1 = store.state.rabbits[0];
        expect(newState_rabbit1.home.state).toBe("Connecticut");
        expect(newState_rabbit1.home.city).toBe("Hartford");
      });

      it("unsets a value with the '$unset' keyword", () => {
        expect(store.state.rabbits).toEqual([rabbit1, rabbit2]);
        store.setState({rabbits: "$unset"});

        tick();
        expect(store.state.rabbits).toBeUndefined();
      });

      it("unsets deeply", () => {
        expect(store.state.rabbits).toEqual([rabbit1, rabbit2]);
        expect(store.state.rabbits[0].home).toEqual({city: "McGregor's garden"})

        let rabbit1_1 = _.merge({}, rabbit1);
        rabbit1_1.home = "$unset";
        store.setState({rabbits: [rabbit1_1, rabbit2]});

        tick();
        expect(store.state.rabbits[0].home).toBeUndefined();
      });
    });
  });



  describe("#replaceState", () => {
    beforeEach(() => {
      store = new Store({rabbit: "MQ"});
    });

    it("replaces the state with a new state object", () => {
      store.replaceState({bunny: "Bugs"});

      tick();
      expect(store.state).toEqual({bunny: "Bugs"});
    });
  });

  describe("#reset", () => {
    let addThing, onAddThing;

    beforeEach(() => {
      store = new Store({rabbit: "MQ"});

      addThing = new Action('addThing')
      onAddThing = (lastState, thing) => {
        let things = lastState.things || [];
        things.push(thing);
        return {things};
      };

      store.when(addThing, onAddThing, Action.strategies.COMPOUND);
    });

    describe("given no argument (soft reset)", () => {
      it("resets the state to initial state and adds it to history stack", () => {
        expect(store.depth).toEqual(1);
        store.setState({rabbit: "Roger"});
        store.setState({bunnies: ["Easter", "Bugs"]});

        tick();

        expect(store.depth).toEqual(3);
        expect(store.state.rabbit).toEqual('Roger');
        expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

        store.reset();

        tick();

        expect(store.depth).toEqual(4);
        expect(store.state.rabbit).toEqual("MQ");
        expect(store.state.bunnies).toBeUndefined();
      });

      it("recalculates state correctly with reset when a previous action is undone", () => {
        let addedThingA = addThing("A");
        addThing("B");
        addThing("C");

        tick();
        expect(store.state).toEqual({rabbit: "MQ", things: ["A","B","C"]});

        store.reset();

        tick();
        expect(store.state).toEqual({rabbit: "MQ"});

        addedThingA.undo();
        expect(store.state).toEqual({rabbit: "MQ"});
      });
    });

    describe("given an argument of true (hard reset)", () => {
      it("resets the state to initial state and resets the history stack", () => {
        expect(store.depth).toEqual(1);
        store.setState({rabbit: "Roger"});
        store.setState({bunnies: ["Easter", "Bugs"]});

        tick();
        expect(store.depth).toEqual(3);
        expect(store.state.rabbit).toEqual('Roger');
        expect(store.state.bunnies).toEqual(["Easter", "Bugs"]);

        store.reset(true);

        tick();
        expect(store.depth).toEqual(1);
        expect(store.state.rabbit).toEqual("MQ");
        expect(store.state.bunnies).toBeUndefined();
      });

      it("nullifies undo functions returned from actions that reduced a now-deleted state history", () => {
        spyOn(store, 'trigger');

        let addedThingA= addThing("A"); // resolves to state 2
        let addedThingB = addThing("B"); // resolves to state 3
        addThing("C"); // resolves to state 4

        expect(store.depth).toEqual(1);
        tick();
        expect(store.depth).toEqual(4);
        expect(store.state).toEqual({rabbit: "MQ", things: ["A", "B", "C"]});

        addedThingA.undo();
        tick();
        // calling undo on addThingA recalculates the state without the delta at version 2
        expect(store.state).toEqual({rabbit: "MQ", things: ["B", "C"]});

        // hard reset the history, erasing state 2
        store.reset(true);

        tick();
        expect(store.depth).toEqual(1);
        expect(store.state).toEqual({rabbit: "MQ"});

        store.setState({bunny: "Bugs"}); // resolves to new state 2

        tick();
        expect(store.depth).toEqual(2);
        expect(store.state).toEqual({rabbit: "MQ", bunny: "Bugs"});

        store.trigger.calls.reset();
        addedThingB.undo();
        addedThingA.redo();

        expect(store.trigger).not.toHaveBeenCalled();
        // state 2 was not affected by the undo function that used to point there
        expect(store.state).toEqual({rabbit: "MQ", bunny: "Bugs"});
      });
    });
  });


  describe("#resetToState", () => {

  });


  describe("#fastForward", () => {

  });


  describe("#rewind", () => {

  });


  describe("#goto", () => {

  });


  describe("#getImmutableState", () => {

  });


  describe("#getInitialState", () =>{
    beforeEach(() =>{
      store = new Store({rabbit: "MQ"});
    });

    it("returns the initial data state", () =>{
      expect(store.getInitialState()).toEqual({rabbit: "MQ"});

      store.setState({rabbit: "Roger"});
      tick()

      expect(store.state.rabbit).toBe("Roger");
      expect(store.getInitialState()).toEqual({rabbit: "MQ"});
    });
  });

  describe("#getState", () => {
    beforeEach(() => {
      store = new Store({rabbit: "MQ"});
    })

    it("returns a state at index", () => {
      store.setState({rabbit: "Bugs"})
      store.setState({phrase: "What's up doc"})
      store.setState({foe: "Elmer Fudd"})
      tick()

      expect( store.getState() ).toEqual({
        rabbit: "Bugs",
        phrase: "What's up doc",
        foe: "Elmer Fudd"
      });

      expect( store.getState(2) ).toEqual({
        rabbit: "Bugs",
        phrase: "What's up doc"
      })
    })
  })


  describe("#onchange", () => {

  });


  describe("#trigger", () => {
    let subscriber;

    beforeEach(() =>{
      store = new Store({rabbit: "MQ"});

      let _subscriber = (state, lastState) => {}
      subscriber = jasmine.createSpy('subscriber')//.and.callFake(_subscriber);
      store.onchange(subscriber);
    });

    it("triggers state subscribers with the current state and last state", () => {

      store.setState({rabbit: "Roger"});
      tick()

      expect(subscriber).toHaveBeenCalledTimes(1)
      let lastCall = subscriber.calls.mostRecent()
      expect(lastCall.args).toEqual([
        {rabbit: "Roger"}, // current state
        {rabbit: "MQ"} // last state
      ]);

    })
  });
});
