import { beforeEach, describe, expect, it } from 'vitest';
import { useTodoStore } from '../../store/useTodoStore';
import { getTodayKey } from '../dateUtils';
import { getKanbanTasks } from '../kanban';

const s = () => useTodoStore.getState();

describe('Kanban: routines appear once', () => {
  beforeEach(() => useTodoStore.setState({ tasks: [] }));

  it('a routine finished today shows only in Done, not also in To do', () => {
    const today = getTodayKey();
    const r = s().addTask({ title: 'Morning planning', scheduledDate: today, recurrence: 'daily' });
    s().addTask({ title: 'One-off', scheduledDate: today });
    s().toggleTaskDone(r.id, today);

    const list = getKanbanTasks(s().tasks, today);
    const routineCards = list.filter((t) => t.title === 'Morning planning');
    expect(routineCards).toHaveLength(1);
    expect(routineCards[0].status).toBe('done');
    expect(list.filter((t) => t.title === 'One-off')).toHaveLength(1);
  });

  it('an open routine shows once, as today’s card', () => {
    const today = getTodayKey();
    s().addTask({ title: 'Read', scheduledDate: '2026-01-01', recurrence: 'daily' });
    const list = getKanbanTasks(s().tasks, today);
    expect(list.filter((t) => t.title === 'Read')).toHaveLength(1);
  });
});
