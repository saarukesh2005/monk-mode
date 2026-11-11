import { useMemo, useState } from 'react';
import { ChevronRight, Flag, Plus, Repeat, Search, Trash2 } from 'lucide-react';
import type { Recurrence, Task } from '@monk/shared-types';
import { RECURRENCES } from '@monk/shared-types';
import { addDays, localDateKey, newId, nextOccurrenceDate } from '@monk/shared-core';
import { validateTask } from '@monk/validation';
import type { PageProps } from '../App';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Textarea, cx, useConfirm, useToast } from '../components/ui';
import { useCategories, useSubjects, useTasks } from '../lib/data';
import { useTable } from '../lib/hooks';
import { remove, save } from '../lib/db';
import { errorMessage } from '../lib/ipc';

interface Tag {
  id: string;
  name: string;
}
interface TaskTag {
  taskId: string;
  tagId: string;
}

type View = 'today' | 'upcoming' | 'all' | 'done';
const PRIORITY = ['None', 'Low', 'High', 'Urgent'] as const;
const PRIORITY_TONE = ['neutral', 'neutral', 'warning', 'danger'] as const;
const REC_LABEL: Record<Recurrence, string> = { none: 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };

export default function Tasks(_: PageProps) {
  const toast = useToast();
  const tasks = useTasks();
  const categories = useCategories();
  const tags = useTable<Tag>('tags', { orderBy: 'name' });
  const taskTags = useTable<TaskTag>('task_tags');
  const [view, setView] = useState<View>('today');
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [quick, setQuick] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const today = localDateKey(Date.now());

  const tagsByTask = useMemo(() => {
    const names = new Map(tags.data.map((t) => [t.id, t.name]));
    const m = new Map<string, string[]>();
    for (const tt of taskTags.data) m.set(tt.taskId, [...(m.get(tt.taskId) ?? []), names.get(tt.tagId) ?? '']);
    return m;
  }, [tags.data, taskTags.data]);

  const children = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks.data) if (t.parentId) m.set(t.parentId, [...(m.get(t.parentId) ?? []), t]);
    return m;
  }, [tasks.data]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.data
      .filter((t) => !t.parentId)
      .filter((t) => {
        if (view === 'done') return t.status === 'done';
        if (t.status === 'done') return false;
        if (view === 'today') return !t.dueDate || t.dueDate <= today;
        if (view === 'upcoming') return !!t.dueDate && t.dueDate > today;
        return true;
      })
      .filter((t) => !categoryFilter || t.categoryId === categoryFilter)
      .filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.notes.toLowerCase().includes(needle) || (tagsByTask.get(t.id) ?? []).some((n) => n.toLowerCase().includes(needle)))
      .sort((a, b) => (view === 'done' ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : b.priority - a.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder));
  }, [tasks.data, view, q, categoryFilter, today, tagsByTask]);

  const quickAdd = async () => {
    const v = validateTask({ title: quick, dueDate: view === 'today' ? today : view === 'upcoming' ? addDays(today, 1) : null });
    if (!v.ok) return toast(v.errors[0] ?? 'Invalid task', 'error');
    try {
      await save('tasks', { id: newId(), ...v.value, sortOrder: Date.now() % 1_000_000_000, categoryId: categoryFilter || null });
      setQuick('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const toggle = async (t: Task) => {
    try {
      const done = t.status === 'todo';
      await save('tasks', { id: t.id, status: done ? 'done' : 'todo', completedAt: done ? Date.now() : null });
      if (done && t.recurrence !== 'none' && t.dueDate) {
        const next = nextOccurrenceDate(t.dueDate < today ? today : t.dueDate, t.recurrence);
        await save('tasks', { id: newId(), title: t.title, notes: t.notes, priority: t.priority, dueDate: next, recurrence: t.recurrence, categoryId: t.categoryId, subjectId: t.subjectId, sortOrder: t.sortOrder });
        toast(`Next one scheduled for ${next}`);
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const counts = {
    today: tasks.data.filter((t) => !t.parentId && t.status === 'todo' && (!t.dueDate || t.dueDate <= today)).length,
    upcoming: tasks.data.filter((t) => !t.parentId && t.status === 'todo' && !!t.dueDate && t.dueDate > today).length,
  };

  return (
    <>
      <PageHeader title="Tasks" subtitle="Capture it, then give it a focus session." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'today', label: `Today ${counts.today ? `· ${counts.today}` : ''}` },
            { value: 'upcoming', label: `Upcoming ${counts.upcoming ? `· ${counts.upcoming}` : ''}` },
            { value: 'all', label: 'All open' },
            { value: 'done', label: 'Completed' },
          ]}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input aria-label="Search tasks" placeholder="Search title, notes or tags" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-40">
          <option value="">All categories</option>
          {categories.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <Card padded={false}>
        {view !== 'done' && (
          <form
            className="flex items-center gap-2 border-b border-line px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void quickAdd();
            }}
          >
            <Plus className="h-4 w-4 text-ink-faint" />
            <input aria-label="New task" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task and press Enter" className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none" />
          </form>
        )}
        {tasks.loading && <Loading />}
        {tasks.error && <div className="p-4"><ErrorState message={tasks.error} onRetry={tasks.reload} /></div>}
        {!tasks.loading && visible.length === 0 && <EmptyState title={view === 'done' ? 'Nothing completed yet' : q ? 'No matching tasks' : 'All clear'} body={view === 'today' ? 'Nothing due today. Add a task above or plan tomorrow.' : undefined} />}
        <ul className="divide-y divide-line">
          {visible.map((t) => {
            const subs = children.get(t.id) ?? [];
            const doneSubs = subs.filter((s) => s.status === 'done').length;
            const cat = categories.data.find((c) => c.id === t.categoryId);
            return (
              <li key={t.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                <Checkbox label={`Complete ${t.title}`} checked={t.status === 'done'} onChange={() => toggle(t)} />
                <button type="button" onClick={() => setEditing(t)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={cx('truncate text-[13px]', t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink')}>{t.title}</span>
                  {subs.length > 0 && <span className="tabular text-[11px] text-ink-faint">{doneSubs}/{subs.length}</span>}
                  {t.recurrence !== 'none' && <Repeat className="h-3 w-3 text-ink-faint" aria-label={REC_LABEL[t.recurrence]} />}
                </button>
                <span className="flex shrink-0 items-center gap-1.5">
                  {(tagsByTask.get(t.id) ?? []).slice(0, 3).map((n) => (
                    <Badge key={n}>#{n}</Badge>
                  ))}
                  {cat && <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} title={cat.name} />}
                  {t.priority >= 2 && <Flag className={cx('h-3.5 w-3.5', t.priority === 3 ? 'text-danger' : 'text-warning')} aria-label={PRIORITY[t.priority]} />}
                  {t.dueDate && <Badge tone={t.status === 'todo' && t.dueDate < today ? 'danger' : 'neutral'}>{t.dueDate === today ? 'Today' : t.dueDate}</Badge>}
                  <ChevronRight className="h-3.5 w-3.5 text-ink-faint opacity-0 group-hover:opacity-100" />
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {editing && <TaskEditor key={editing.id} task={editing} subtasks={children.get(editing.id) ?? []} tags={tags.data} taskTags={taskTags.data} onClose={() => setEditing(null)} onToggle={toggle} />}
    </>
  );
}

function TaskEditor({ task, subtasks, tags, taskTags, onClose, onToggle }: { task: Task; subtasks: Task[]; tags: Tag[]; taskTags: TaskTag[]; onClose: () => void; onToggle: (t: Task) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const categories = useCategories();
  const subjects = useSubjects();
  const [draft, setDraft] = useState(task);
  const [sub, setSub] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const current = taskTags.filter((tt) => tt.taskId === task.id).map((tt) => tags.find((t) => t.id === tt.tagId)).filter((t): t is Tag => !!t);

  const saveTask = async () => {
    const v = validateTask(draft);
    if (!v.ok) return setErrors(v.errors);
    try {
      await save('tasks', { id: task.id, ...v.value, categoryId: draft.categoryId || null, subjectId: draft.subjectId || null });
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const addSub = async () => {
    const v = validateTask({ title: sub });
    if (!v.ok) return;
    await save('tasks', { id: newId(), parentId: task.id, ...v.value, sortOrder: subtasks.length }).catch((e) => toast(errorMessage(e), 'error'));
    setSub('');
  };

  const addTag = async () => {
    const name = tagInput.trim().replace(/^#/, '').toLowerCase().slice(0, 40);
    if (!name) return;
    try {
      const tag = tags.find((t) => t.name === name) ?? (await save<Tag>('tags', { id: newId(), name }));
      await save('task_tags', { taskId: task.id, tagId: tag.id });
      setTagInput('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const del = async () => {
    if (await confirm({ title: 'Delete task?', body: `“${task.title}” and its subtasks will be deleted.`, confirmLabel: 'Delete', danger: true })) {
      await remove('tasks', { id: task.id }).catch((e) => toast(errorMessage(e), 'error'));
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit task"
      width="max-w-xl"
      footer={
        <div className="flex w-full justify-between">
          <Button variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={del}>
            Delete
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={saveTask}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {errors.length > 0 && <ErrorState message={errors.join(' · ')} />}
        <Field label="Title">{(id) => <Input id={id} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">{(id) => <Input id={id} type="date" value={draft.dueDate ?? ''} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} />}</Field>
          <Field label="Repeats">
            {(id) => (
              <Select id={id} value={draft.recurrence} onChange={(e) => setDraft({ ...draft, recurrence: e.target.value as Recurrence })}>
                {RECURRENCES.map((r) => (
                  <option key={r} value={r}>
                    {REC_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) as Task['priority'] })}>
                {PRIORITY.map((p, i) => (
                  <option key={p} value={i}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={draft.categoryId ?? ''} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })}>
                <option value="">None</option>
                {categories.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Subject">
            {(id) => (
              <Select id={id} value={draft.subjectId ?? ''} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value || null })}>
                <option value="">None</option>
                {subjects.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Notes">{(id) => <Textarea id={id} rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />}</Field>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-muted">Tags</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {current.map((t) => (
              <button key={t.id} type="button" title="Remove tag" onClick={() => remove('task_tags', { taskId: task.id, tagId: t.id }).catch(() => undefined)} className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-ink-muted hover:text-danger">
                #{t.name} ×
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addTag();
              }}
            >
              <input aria-label="Add tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="+ tag" list="monk-tags" className="w-24 bg-transparent text-[12px] text-ink placeholder:text-ink-faint focus:outline-none" />
              <datalist id="monk-tags">
                {tags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </form>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-muted">Subtasks</div>
          <ul className="space-y-1">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5">
                <Checkbox label={`Complete ${s.title}`} checked={s.status === 'done'} onChange={() => onToggle(s)} />
                <span className={cx('flex-1 text-[13px]', s.status === 'done' ? 'text-ink-faint line-through' : 'text-ink')}>{s.title}</span>
                <IconButton label="Delete subtask" onClick={() => remove('tasks', { id: s.id }).catch(() => undefined)}>
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addSub();
            }}
          >
            <Plus className="h-3.5 w-3.5 text-ink-faint" />
            <input aria-label="New subtask" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add subtask" className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none" />
          </form>
        </div>
      </div>
    </Modal>
  );
}
