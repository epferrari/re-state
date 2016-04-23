# Async Actions in ReState

Reducers passed into actions in restate should be synchronous, pure, and return a new representation of state based on the delta passed to them. So how would you perform an asynchronous operation with your server?

Let's take a simple example of saving a todo item, in which we add a pending state to the application while it waits for the todo to be saved on the server.


	import {Container, Action} from 're-state';

	let todoApp, beginAddTodo, completeAddTodo, clickHandler;

	todoApp = new Container({todos: [], todosPendingSave: [], pending: false})

	beginAddTodo = new Action((lastState, todo) => {
		let {todosPendingSave} = lastState

		if(todosPendingSave.indexOf(todo.id) === -1)
			todosPendingSave.push(todo.id)

		return { todosPendingSave, pending: (todosPendingSave.length > 0)}
	})

	completeAddTodo = new Action((lastState, todo) => {
		let {todosPendingSave, todos} = lastState
		let todoIndex = todosPendingSave.indexOf(todo.id)

		todosPendingSave.splice(todoIndex, 1)
		todos.push(todo)

		return {todos, todosPendingSave, pending: (todosPendingSave.length > 0)}
	})

	todoApp.listenToMany([beginAddTodo, completeAddTodo])

	// assume we have a Todo class that creates a todo with an id and a save method
	clickHandler = () => {
		let text = /* get todo text somehow */
		let todo = new Todo(text)
		let undo = beginAddTodo(todo)

		todo.save()
			.then(completeAddTodo)
			.catch(error => {
				undo()
				// assume we have implemented a notification service for our user
				NotifyService.sendError(error)
			})
	}

	// and then just call the clickHandler() function when [Add Todo] button is clicked


Now an example that assumes the server will respond by saving the todo, which makes our app seem faster. Remember to implement some kind of notification service to alert the user when something goes awry, otherwise the automatic undo would be confusing.


	import {Container, Action} from 're-state';

	let todoApp, addTodo, clickHandler;

	todoApp = new Container({todos: [], unsavedTodos: []})

	addTodo = new ReState.Action((lastState, todo) => {
		let {todos, unsavedTodos} = lastState
		let unsavedIndex = unsavedTodos.indexOf(todo)

		if(unsavedIndex !== -1)
			unsavedTodos.splice(unsavedIndex, 1)

		todos.push(todo)
		return { todos, unsavedTodos }
	})

	todoApp.listenTo(addTodo)

	clickHandler = () => {
		let text = /* get todo text somehow */
		let todo = new Todo(text)
		let undo = addTodo(todo)
		let saveDidFail = (error) => {
			undo()
			NotifyService.sendError(error)
			let {unsavedTodos} = todoApp.state
			unsavedTodos.push(todo)
			todoApp.setState({unsavedTodos})
		}

		todo.save().catch(saveDidFail)
	}
