describe "Action Factory", ->
  Action = action = undefined

  beforeEach module('app.factories.action')

  beforeEach inject(($injector) ->
    Action = $injector.get("Action")
    action = new Action()
  )

  describe "constructor", ->
    it "returns a function with an `triggers` method", ->
      expect(typeof action).toBe("function")
      expect(typeof action.triggers).toBe("function")

  describe "trigger and invocation", ->
    cb1 = cb2 = undefined

    beforeEach ->
      cb1 = jasmine.createSpy()
      cb2 = jasmine.createSpy()

      action.triggers(cb1)
      action.triggers(cb2)

    it "invokes the callbacks with the right arguments", ->
      action('hot', 'dog')

      expect(cb1).toHaveBeenCalledWith('hot', 'dog')
      expect(cb2).toHaveBeenCalledWith('hot', 'dog')
