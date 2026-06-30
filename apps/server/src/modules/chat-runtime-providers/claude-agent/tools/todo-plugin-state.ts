export type TodoPluginStatus = 'todo' | 'processing' | 'completed'

export interface TodoPluginItem {
  id: string | null
  content: string
  status: TodoPluginStatus
  sourceStatus: string | null
}

export interface TodoWritePluginState {
  todos: TodoPluginItem[]
}

interface RawTodoItem {
  id: string | null
  content: string | null
  activeForm: string | null
  status: string | null
}

export function isTodoWriteToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === 'todowrite' || normalized === 'todo_write'
}

export function synthesizeTodoWritePluginState(input: unknown): TodoWritePluginState | null {
  const todos = readPrimaryTodos(input).map(projectTodoPluginItem)
  return todos.length > 0 ? { todos } : null
}

function projectTodoPluginItem(todo: RawTodoItem): TodoPluginItem {
  const status = mapTodoStatus(todo.status)
  return {
    id: todo.id,
    content: readTodoContent(todo, status),
    status,
    sourceStatus: todo.status,
  }
}

function readPrimaryTodos(value: unknown): RawTodoItem[] {
  const record = isRecord(value) ? value : {}
  const candidates = [
    readTodos(record.todos),
    readTodos(record.newTodos),
    readTodos(record.tasks),
    readTodos(record.items),
    readSingleTodo(record),
  ]
  return candidates.find(items => items.length > 0) ?? []
}

function readTodos(value: unknown): RawTodoItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return {
      id: readNullableString(record.id) ?? readNullableString(record.task_id),
      content: readNullableString(record.content)
        ?? readNullableString(record.title)
        ?? readNullableString(record.task)
        ?? readNullableString(record.description),
      activeForm: readNullableString(record.activeForm) ?? readNullableString(record.active_form),
      status: readNullableString(record.status),
    }
  }).filter(todo => todo.content !== null || todo.activeForm !== null)
}

function readSingleTodo(record: Record<string, unknown>): RawTodoItem[] {
  return readTodos([{
    id: record.id ?? record.task_id,
    content: record.content ?? record.title ?? record.task ?? record.description,
    activeForm: record.activeForm ?? record.active_form,
    status: record.status,
  }])
}

function mapTodoStatus(status: string | null): TodoPluginStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
    case 'processing':
      return 'processing'
    case 'pending':
    case 'todo':
    default:
      return 'todo'
  }
}

function readTodoContent(todo: RawTodoItem, status: TodoPluginStatus): string {
  if (status === 'processing') {
    return todo.activeForm ?? todo.content ?? 'Untitled task'
  }
  return todo.content ?? todo.activeForm ?? 'Untitled task'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
