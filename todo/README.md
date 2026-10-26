# todo

A simple todo app. Create a task, mark it done, delete it, and organise tasks with due dates and tags.

- **Run:** open `index.html` in a browser. No build step, no server, no dependencies.
- **Filters:** All · Active · Completed, plus a tag filter (one tag at a time). The app remembers the last filter you used.
- **Due dates:** optional. Tasks sort by due date, with undated tasks last. Overdue tasks show in red and tasks due today in amber.
- **Tags:** comma separated when you add a task (`work, home`), saved in lowercase. Use **Edit** on a task to change its due date or tags.
- **Storage:** tasks live in the browser's IndexedDB (database `todo-app`, store `tasks`), so they survive a page reload. Tasks from the first version keep working. The last filter is kept in localStorage.
- **History:** #4 first version · #5 filters, due dates and tags.
