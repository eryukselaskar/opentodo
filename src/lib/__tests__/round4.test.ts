import { describe, it, expect, beforeEach } from 'vitest';
import { useTodoStore } from '../../store/useTodoStore';

const s = () => useTodoStore.getState();

describe('Etiket yeniden adlandırma', () => {
  beforeEach(() => {
    useTodoStore.setState({
      tasks: [],
      tagDefs: [
        { name: 'iş', color: 'blue' },
        { name: 'proje', color: 'purple' },
      ],
      selectedTagFilter: null,
    });
  });

  it('etiketi tanımda ve tüm görevlerde değiştirir, rengi korur', () => {
    const a = s().addTask({ title: 'A', tags: ['iş', 'acil'] });
    const b = s().addTask({ title: 'B', tags: ['ev'] });
    s().renameTag('iş', '#Ofis ');
    expect(s().tagDefs).toContainEqual({ name: 'ofis', color: 'blue' });
    expect(s().tagDefs.some((d) => d.name === 'iş')).toBe(false);
    expect(s().tasks.find((t) => t.id === a.id)!.tags).toEqual(['ofis', 'acil']);
    expect(s().tasks.find((t) => t.id === b.id)!.tags).toEqual(['ev']);
  });

  it('var olan bir etikete adlandırınca birleştirir, çift etiket oluşmaz', () => {
    const a = s().addTask({ title: 'A', tags: ['iş', 'proje'] });
    s().renameTag('iş', 'proje');
    expect(s().tasks.find((t) => t.id === a.id)!.tags).toEqual(['proje']);
    expect(s().tagDefs).toEqual([{ name: 'proje', color: 'purple' }]);
  });

  it('renksiz (tanımsız) etiketi de görevlerde değiştirir', () => {
    const a = s().addTask({ title: 'A', tags: ['hobi'] });
    s().renameTag('hobi', 'oyun');
    expect(s().tasks.find((t) => t.id === a.id)!.tags).toEqual(['oyun']);
    expect(s().tagDefs).toHaveLength(2);
  });

  it('boş ad bir şey değiştirmez; aktif filtre yeni ada geçer', () => {
    s().addTask({ title: 'A', tags: ['iş'] });
    s().renameTag('iş', '  # ');
    expect(s().tasks[0].tags).toEqual(['iş']);
    s().setSelectedTagFilter('iş');
    s().renameTag('iş', 'ofis');
    expect(s().selectedTagFilter).toBe('ofis');
  });
});
