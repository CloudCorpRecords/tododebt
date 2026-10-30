// NOTE: notes are fine and are not markers
const todolist = ["TODOLIST is one word, not a marker"];
// todo: lowercase only, not counted
export function demo(obj: { todo: () => void }): void {
  obj.todo();
}
