# todo

A simple todo app. Create a task, mark it done, delete it, and organise tasks with due dates, tags, repeats and priority.

- **Run:** open `index.html` in a browser. No build step, no server, no dependencies.
- **Filters:** All · Active · Completed, plus priority, due-date and tag filters (one tag at a time). The app remembers the last filter you used.
- **Due dates:** optional. Tasks sort by due date, with undated tasks last. Overdue tasks show in red and tasks due today in amber.
- **Tags:** comma separated when you add a task (`work, home`), saved in lowercase. Use **Edit** on a task to change its due date or tags.
- **Repeating tasks:** Daily, Weekdays, Weekly or Monthly. Ticking one off keeps it in Completed and adds the next copy. Missed days give one copy due today, not a backlog. Monthly keeps the day of the month (31 Jan → 28 Feb → 31 Mar). Set, change or turn off the repeat with **Edit**.
- **Priority:** High, Medium or Low (default Medium) when you add a task, or later with **Edit**. High and Low show a label; Medium stays unlabelled. A priority filter (Any · High · Medium · Low) combines with the others and is remembered. Tasks due on the same day sort High first. Repeating tasks keep their priority.
- **Search:** a box above the filters matches as you type, case-insensitive, in titles and tags (`wor` finds `#work`). Several words must all match. It combines with every filter. ✕ or `Esc` clears it, and it starts empty after a reload.
- **Due-date filter:** Any date · Overdue · Today · Next 7 days (today + 6 days) · No date. It combines with the others and is remembered.
- **Footer:** shows how many tasks are open and done (`3 open · 5 done`), counting all tasks. With a filter on it adds `showing N`. Hidden when the list is empty.
- **Limits:** titles up to 200 characters, tags up to 30 characters, 10 tags per task. Anything longer is cut and a notice says so; tasks saved before the limits still show in full until edited.
- **Storage:** tasks live in the browser's IndexedDB (database `todo-app`, store `tasks`), so they survive a page reload. Tasks from the first version keep working. The last filter is kept in localStorage.
- **History:** #4 first version · #5 filters, due dates and tags · #7 repeating tasks · #11 priority · #12 count footer · #13 search.
