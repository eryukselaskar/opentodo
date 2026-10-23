import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useId,
  Fragment,
  type ReactNode,
  type KeyboardEvent as RKeyboardEvent,
} from 'react';
import {
  Search,
  Calendar,
  CalendarDays,
  CalendarRange,
  Columns3,
  Timer,
  BarChart3,
  RotateCcw,
  DownloadCloud,
  CheckCircle2,
  Circle,
  Play,
  Plus,
  ArrowRight,
  Sparkles,
  Layers,
  X,
} from 'lucide-react';
import { ViewMode } from '../../types/todo';
import { useTodoStore } from '../../store/useTodoStore';
import { formatTurkishDate } from '../../lib/dateUtils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/primitives';
import { t as tt } from '../../lib/i18n';

interface CommandItem {
  id: string;
  group: 'create' | 'views' | 'actions' | 'tasks';
  title: string;
  subtitle?: string;
  icon: ReactNode;
  badge?: string;
  onSelect: () => void;
  secondaryAction?: {
    label: string;
    icon: ReactNode;
    onSelect: () => void;
  };
}

export function CommandPalette() {
  const isOpen = useTodoStore((s) => s.commandPaletteOpen);
  const setOpen = useTodoStore((s) => s.setCommandPaletteOpen);
  const tasks = useTodoStore((s) => s.tasks);
  const setActiveView = useTodoStore((s) => s.setActiveView);
  const rolloverOverdueTasks = useTodoStore((s) => s.rolloverOverdueTasks);
  const setBackupModalOpen = useTodoStore((s) => s.setBackupModalOpen);
  const setEditingTaskId = useTodoStore((s) => s.setEditingTaskId);
  const setActiveFocusTaskId = useTodoStore((s) => s.setActiveFocusTaskId);
  const addTaskFromRaw = useTodoStore((s) => s.addTaskFromRaw);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Listen for Cmd+K / Ctrl+K globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!isOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOpen]);

  // Reset query and selectedIndex when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, [setOpen]);

  // Build command items
  const items = useMemo(() => {
    const trimmed = query.trim();
    const result: CommandItem[] = [];

    // 1. Quick Task Creation option. Only first (Enter target) when typed with "+";
    // otherwise it goes last so Enter opens a matching view/task instead of creating junk.
    const isExplicitCreate = trimmed.startsWith('+');
    const taskTitleToCreate = isExplicitCreate ? trimmed.slice(1).trim() : trimmed;
    let createItem: CommandItem | null = null;

    if (taskTitleToCreate.length > 0) {
      createItem = {
        id: 'create-task',
        group: 'create',
        title: tt(`Add new task: "${taskTitleToCreate}"`, `Yeni Görev Ekle: "${taskTitleToCreate}"`),
        subtitle: tt('Natural tokens (#work, !urgent, @tomorrow) are supported', 'Doğal dil etiketleri (#iş, !acil, @yarın) desteklenir'),
        icon: <Plus className="h-4 w-4 text-stone-700" />,
        badge: 'ENTER',
        onSelect: () => {
          addTaskFromRaw(taskTitleToCreate);
          closePalette();
        },
      };
      if (isExplicitCreate) result.push(createItem);
    }

    // 2. Views
    const viewsList: Array<{ view: ViewMode; name: string; desc: string; icon: React.ReactNode }> = [
      {
        view: 'day',
        name: tt('Day view', 'Günüm Görünümü'),
        desc: tt('Today\'s tasks and your 3 most important tasks (MIT)', 'Bugünün odağındaki görevler ve en önemli 3 iş (MIT)'),
        icon: <Calendar className="h-4 w-4 text-stone-600" />,
      },
      {
        view: 'week',
        name: tt('Week view', 'Haftam Görünümü'),
        desc: tt('7-day time blocks and the weekly task pool', '7 günlük zaman blokları ve haftalık görev havuzu'),
        icon: <CalendarDays className="h-4 w-4 text-stone-600" />,
      },
      {
        view: 'month',
        name: tt('Month view', 'Ayım Görünümü'),
        desc: tt('Monthly calendar and milestones', 'Aylık takvim ve stratejik kilometre taşları'),
        icon: <CalendarRange className="h-4 w-4 text-stone-600" />,
      },
      {
        view: 'kanban',
        name: tt('Kanban board', 'Kanban Panosu'),
        desc: tt('To do, in progress and done columns', 'Yapılacak, Devam Eden ve Tamamlanan sütunları'),
        icon: <Columns3 className="h-4 w-4 text-stone-600" />,
      },
      {
        view: 'focus',
        name: tt('Focus / Pomodoro', 'Odak / Pomodoro Modu'),
        desc: tt('Deep-work timer on a distraction-free screen', 'Derin çalışma sayacı ve minimal dikkat dağıtmayan ekran'),
        icon: <Timer className="h-4 w-4 text-stone-600" />,
      },
      {
        view: 'analytics',
        name: tt('Analytics and reports', 'Analitik ve Raporlar'),
        desc: tt('Productivity, completion rates and focus breakdown', 'Üretkenlik, tamamlama oranları ve odak dağılımı'),
        icon: <BarChart3 className="h-4 w-4 text-stone-600" />,
      },
    ];

    const matchingViews = viewsList.filter(
      (v) =>
        !trimmed ||
        v.name.toLowerCase().includes(trimmed.toLowerCase()) ||
        v.desc.toLowerCase().includes(trimmed.toLowerCase())
    );

    matchingViews.forEach((v) => {
      result.push({
        id: `view-${v.view}`,
        group: 'views',
        title: v.name,
        subtitle: v.desc,
        icon: v.icon,
        onSelect: () => {
          setActiveView(v.view);
          closePalette();
        },
      });
    });

    // 3. Quick Actions
    const actionsList = [
      {
        id: 'rollover-today',
        title: tt('Move overdue tasks to today', 'Geçmiş Görevleri Bugüne Aktar'),
        subtitle: tt('Moves every overdue task to today, guilt-free', 'Tüm gecikmiş görevleri suçluluk duymadan bugüne taşır'),
        icon: <RotateCcw className="h-4 w-4 text-stone-600" />,
        onSelect: () => {
          rolloverOverdueTasks('to_today');
          closePalette();
        },
      },
      {
        id: 'rollover-week',
        title: tt('Leave overdue tasks in the weekly pool', 'Geçmiş Görevleri Haftalık Havuza Bırak'),
        subtitle: tt('Moves overdue tasks into this week\'s pool', 'Gecikmiş görevleri bu haftanın havuzuna delege eder'),
        icon: <Layers className="h-4 w-4 text-stone-600" />,
        onSelect: () => {
          rolloverOverdueTasks('to_week_pool');
          closePalette();
        },
      },
      {
        id: 'backup-data',
        title: tt('Back up / import data (JSON)', 'Veri Yedekle / İçe Aktar (JSON)'),
        subtitle: tt('Export all your data or load a backup', 'Tüm verilerinizi dışa aktarın veya yedeğinizi yükleyin'),
        icon: <DownloadCloud className="h-4 w-4 text-stone-600" />,
        onSelect: () => {
          setBackupModalOpen(true);
          closePalette();
        },
      },
    ];

    const matchingActions = actionsList.filter(
      (a) =>
        !trimmed ||
        a.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        a.subtitle.toLowerCase().includes(trimmed.toLowerCase())
    );

    matchingActions.forEach((a) => {
      result.push({
        id: a.id,
        group: 'actions',
        title: a.title,
        subtitle: a.subtitle,
        icon: a.icon,
        onSelect: a.onSelect,
      });
    });

    // 4. Matching Tasks
    if (trimmed.length > 0) {
      const qLower = trimmed.toLowerCase();
      const matchingTasks = tasks
        .filter((t) => {
          if (isExplicitCreate) return false;
          const matchTitle = t.title.toLowerCase().includes(qLower);
          const matchNotes = t.notes.toLowerCase().includes(qLower);
          const matchTags = t.tags.some((tag) => tag.toLowerCase().includes(qLower));
          return matchTitle || matchNotes || matchTags;
        })
        .slice(0, 10);

      matchingTasks.forEach((t) => {
        result.push({
          id: `task-${t.id}`,
          group: 'tasks',
          title: t.title,
          subtitle: `${t.scheduledDate ? formatTurkishDate(t.scheduledDate) : tt('No date', 'Tarihsiz')} • ${
            t.tags.length > 0 ? t.tags.map((tg) => '#' + tg).join(' ') : tt('No tags', 'Etiketsiz')
          }`,
          icon:
            t.status === 'done' ? (
              <CheckCircle2 className="h-4 w-4 text-stone-700" />
            ) : (
              <Circle className="h-4 w-4 text-stone-400" />
            ),
          badge: t.priority !== 'medium' ? t.priority.toUpperCase() : undefined,
          onSelect: () => {
            setEditingTaskId(t.id);
            closePalette();
          },
          secondaryAction: {
            label: tt('Focus', 'Odaklan'),
            icon: <Play className="h-3 w-3 fill-current" />,
            onSelect: () => {
              setActiveFocusTaskId(t.id);
              setActiveView('focus');
              closePalette();
            },
          },
        });
      });
    }

    if (createItem && !isExplicitCreate) result.push(createItem);

    return result;
  }, [
    query,
    tasks,
    setActiveView,
    rolloverOverdueTasks,
    setBackupModalOpen,
    setEditingTaskId,
    setActiveFocusTaskId,
    addTaskFromRaw,
    closePalette,
  ]);

  // Adjust selection clamping when items change
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (items.length === 0) return 0;
      return Math.min(prev, items.length - 1);
    });
  }, [items.length]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-selected="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = (e: RKeyboardEvent) => {
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = items[selectedIndex];
      if (current) {
        current.onSelect();
      }
    }
  };

  const groupLabels: Record<string, string> = {
    create: tt('Quick create', 'Hızlı Oluştur'),
    views: tt('Views', 'Görünümler'),
    actions: tt('Actions', 'Eylemler'),
    tasks: tt('Matching tasks', 'Eşleşen Görevler'),
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden bg-[#FAF9F5] text-stone-900 border border-stone-200 shadow-xl rounded-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{tt('Command palette', 'Komut Paleti')}</DialogTitle>
          <DialogDescription>{tt('Quick navigation, actions and task search', 'Hızlı gezinme, eylemler ve görev arama')}</DialogDescription>
        </DialogHeader>

        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 bg-white/60">
          <Search className="h-4 w-4 shrink-0 text-stone-400" />
          <label htmlFor={inputId} className="sr-only">
            {tt('Search commands or add a task', 'Komut ara veya görev ekle')}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={tt('Search a command or task... (start with + to create a task)', 'Bir komut veya görev arayın... (+ ile hızlı görev oluştur)')}
            className="flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none"
            autoComplete="off"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-stone-400 hover:text-stone-700 p-0.5 rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-stone-200 bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-500">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[380px] overflow-y-auto p-2 space-y-1 select-none"
          tabIndex={-1}
        >
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-stone-300 mb-2" />
              <p className="text-sm text-stone-600">{tt('No matching command or task', 'Eşleşen komut veya görev bulunamadı')}</p>
              <p className="text-xs text-stone-400 mt-1">
                {tt('Start with + to add it as a new task', 'Başına + yazarak yeni görev olarak ekleyebilirsiniz')}
              </p>
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const prevItem = items[idx - 1];
              const showGroupHeader = !prevItem || prevItem.group !== item.group;

              return (
                <Fragment key={item.id}>
                  {showGroupHeader && (
                    <div className="px-3 pt-3 pb-1 text-xs font-semibold text-stone-400">
                      {groupLabels[item.group]}
                    </div>
                  )}

                  <div
                    data-selected={isSelected}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-stone-200/70 text-stone-900 border border-stone-300/60'
                        : 'text-stone-600 hover:bg-stone-100 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          isSelected
                            ? 'bg-stone-100 border-stone-300 text-stone-800'
                            : 'bg-white border-stone-200 text-stone-500'
                        }`}
                      >
                        {item.icon}
                      </div>

                      <div className="min-w-0 flex flex-col">
                        <span className="truncate font-medium text-xs sm:text-sm text-stone-900">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="truncate text-xs text-stone-500">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.badge && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                          {item.badge}
                        </span>
                      )}

                      {item.secondaryAction && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.secondaryAction?.onSelect();
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1 px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs transition-opacity cursor-pointer"
                        >
                          {item.secondaryAction.icon}
                          <span>{item.secondaryAction.label}</span>
                        </button>
                      )}

                      {isSelected && (
                        <ArrowRight className="h-3.5 w-3.5 text-stone-600 shrink-0" />
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })
          )}
        </div>

        {/* Command Palette Keyboard Hints Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-stone-100/70 border-t border-stone-200 text-xs text-stone-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white border border-stone-200 text-stone-600">
                ↑↓
              </kbd>
              {tt('Navigate', 'Gezin')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white border border-stone-200 text-stone-600">
                ↵
              </kbd>
              {tt('Select', 'Seç')}
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white border border-stone-200 text-stone-600">
                +
              </kbd>
              {tt('Quick task', 'Hızlı Görev')}
            </span>
          </div>

          <div className="text-stone-400">Todo Plus</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
