import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useTodoStore } from '../../store/useTodoStore';
import { autoScheduleWeekWithAI } from '../ollamaClient';
import { PRESET_TAGS, getTagColor, normalizeTagName, collectAllTags, getTaskColor, getTaskColorClass } from '../tags';
import { computeRoutineStats } from '../analytics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Hafta dengeleme (yerel algoritma)', () => {
  it('modele istek atmaz, sıralı görevleri en boş günlere dağıtır', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await autoScheduleWeekWithAI(
      [
        { id: 'b', title: 'Rapor (2/2)', priority: 'medium', estimatedMinutes: 30 },
        { id: 'a', title: 'Rapor (1/2)', priority: 'medium', estimatedMinutes: 30 },
      ],
      [
        { dateKey: '2026-10-19', dayName: 'Pazartesi', currentMinutes: 300, workMinutes: 300 },
        { dateKey: '2026-10-20', dayName: 'Salı', currentMinutes: 0, workMinutes: 0 },
        { dateKey: '2026-10-21', dayName: 'Çarşamba', currentMinutes: 0, workMinutes: 0 },
      ]
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.assignments.map((a) => [a.taskId, a.dateKey])).toEqual([
      ['a', '2026-10-20'],
      ['b', '2026-10-21'],
    ]);
  });
});

describe('Koyu tema varsayılan', () => {
  it('yeni kurulum koyu temayla başlar', () => {
    expect(useTodoStore.getInitialState().darkMode).toBe(true);
  });

  it('eski (v1) kayıtlar bir kez koyu temaya geçirilir', () => {
    const migrate = useTodoStore.persist.getOptions().migrate!;
    const migrated = migrate({ tasks: [], darkMode: false }, 1) as { darkMode: boolean };
    expect(migrated.darkMode).toBe(true);
  });
});

describe('Renkli etiketler', () => {
  beforeEach(() => {
    useTodoStore.setState({ tasks: [], tagDefs: PRESET_TAGS.map((t) => ({ ...t })) });
  });

  it('hazır etiketler doğru renklerle gelir', () => {
    const defs = useTodoStore.getState().tagDefs;
    expect(getTagColor('health', defs)).toBe('green');
    expect(getTagColor('sport', defs)).toBe('lime');
    expect(getTagColor('work', defs)).toBe('blue');
    expect(getTagColor('urgent', defs)).toBe('red');
    expect(defs).toHaveLength(10);
  });

  it('tanımsız etiket gri görünür, büyük harf / # farkı önemsizdir', () => {
    const defs = useTodoStore.getState().tagDefs;
    expect(getTagColor('bilinmeyen', defs)).toBe('gray');
    expect(getTagColor('#Sport', defs)).toBe('lime');
    expect(normalizeTagName('  #Ev ')).toBe('ev');
  });

  it('kullanıcı etiket ekler, rengini değiştirir ve siler', () => {
    const s = () => useTodoStore.getState();
    s().upsertTagDef('#Hobi', 'pink');
    expect(getTagColor('hobi', s().tagDefs)).toBe('pink');

    s().upsertTagDef('hobi', 'cyan');
    expect(s().tagDefs.filter((t) => t.name === 'hobi')).toHaveLength(1);
    expect(getTagColor('hobi', s().tagDefs)).toBe('cyan');

    s().removeTagDef('hobi');
    expect(getTagColor('hobi', s().tagDefs)).toBe('gray');
  });

  it('boş isim eklenmez', () => {
    useTodoStore.getState().upsertTagDef('  # ', 'red');
    expect(useTodoStore.getState().tagDefs).toHaveLength(10);
  });

  it('yedekte etiket renkleri dışa ve içe aktarılır', () => {
    const s = () => useTodoStore.getState();
    s().upsertTagDef('hobi', 'pink');
    const json = s().exportJson();
    s().removeTagDef('hobi');
    expect(s().importJson(json).ok).toBe(true);
    expect(getTagColor('hobi', s().tagDefs)).toBe('pink');
  });

  it('eski yedek (etiket bilgisi yok) mevcut etiketleri bozmaz', () => {
    const s = () => useTodoStore.getState();
    expect(s().importJson(JSON.stringify({ tasks: [] })).ok).toBe(true);
    expect(s().tagDefs).toHaveLength(10);
  });

  it('kullanılan ama tanımsız etiketler de listelenir', () => {
    const all = collectAllTags(PRESET_TAGS, [{ tags: ['oyun', 'health'] }, { tags: ['kod'] }]);
    expect(all.map((t) => t.name)).toEqual([
      ...PRESET_TAGS.map((t) => t.name),
      'kod',
      'oyun',
    ]);
    expect(all.find((t) => t.name === 'oyun')).toMatchObject({ color: 'gray', defined: false });
  });
});

describe('Rutin geçmişi takvimi', () => {
  beforeEach(() => {
    useTodoStore.setState({ tasks: [], milestones: [], focusLogs: [] });
  });

  it('pencerenin her günü için durum verir: yapıldı / kaçırıldı / plansız / bugün açık', () => {
    const s = () => useTodoStore.getState();
    const t = s().addTask({ title: 'Su iç', scheduledDate: '2026-10-18', recurrence: 'daily' });
    s().toggleTaskDone(t.id, '2026-10-18');
    s().toggleTaskDone(t.id, '2026-10-20');
    s().skipTaskForDate(t.id, '2026-10-21');

    const [stat] = computeRoutineStats(s().tasks, '2026-10-22', 7); // 16..22
    expect(stat.calendar).toEqual([
      { dateKey: '2026-10-16', status: 'none' },
      { dateKey: '2026-10-17', status: 'none' },
      { dateKey: '2026-10-18', status: 'done' },
      { dateKey: '2026-10-19', status: 'missed' },
      { dateKey: '2026-10-20', status: 'done' },
      { dateKey: '2026-10-21', status: 'none' },
      { dateKey: '2026-10-22', status: 'pending' },
    ]);
  });

  it('bugün yapıldıysa bugün "done" görünür', () => {
    const s = () => useTodoStore.getState();
    const t = s().addTask({ title: 'Kitap', scheduledDate: '2026-10-22', recurrence: 'daily' });
    s().toggleTaskDone(t.id, '2026-10-22');
    const [stat] = computeRoutineStats(s().tasks, '2026-10-22', 3);
    expect(stat.calendar.map((d) => d.status)).toEqual(['none', 'none', 'done']);
  });
});

describe('Görev arka plan rengi', () => {
  it('görevin ilk renkli etiketinin rengini alır', () => {
    expect(getTaskColor(['rutin', 'health', 'work'], PRESET_TAGS)).toBe('green');
    expect(getTaskColor(['work', 'health'], PRESET_TAGS)).toBe('blue');
  });

  it('renkli etiketi yoksa renk yok', () => {
    expect(getTaskColor(['rutin', 'discord'], PRESET_TAGS)).toBeNull();
    expect(getTaskColor([], PRESET_TAGS)).toBeNull();
    expect(getTaskColorClass([], PRESET_TAGS)).toBe('');
  });

  it('renkli görev için arka plan + sol kenar sınıfı döner', () => {
    const cls = getTaskColorClass(['sport'], PRESET_TAGS);
    expect(cls).toContain('border-l-4');
    expect(cls).toContain('lime');
  });
});
