import { formatDistance } from '../core/units';
import { KIND_LABEL, objectDistance, type AtlasObject } from '../data/objects';

function norm(value: string): string {
  return value.toLowerCase().replace(/[\s·.\-_'’()（）]/g, '');
}

export class SearchBox {
  private input: HTMLInputElement;
  private results: HTMLElement;
  private matches: AtlasObject[] = [];
  private active = 0;
  onSelect: (object: AtlasObject) => void = () => {};

  constructor(private root: HTMLElement, private objects: () => AtlasObject[]) {
    this.input = root.querySelector('input') as HTMLInputElement;
    this.results = root.querySelector('.search__results') as HTMLElement;
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', event => this.handleKey(event));
    this.input.addEventListener('focus', () => this.update());
    document.addEventListener('pointerdown', event => {
      if (!root.contains(event.target as Node)) this.clear(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && document.activeElement !== this.input) {
        event.preventDefault();
        this.input.focus();
      }
    });
  }

  private update(): void {
    const q = norm(this.input.value);
    if (!q) {
      this.matches = [];
      this.render();
      return;
    }
    const scored: Array<{ object: AtlasObject; score: number }> = [];
    for (const object of this.objects()) {
      const names = [object.zh, object.en ?? '', object.id, object.des ?? ''].map(norm);
      let score = -1;
      for (const name of names) {
        if (!name) continue;
        if (name === q) score = Math.max(score, 100);
        else if (name.startsWith(q)) score = Math.max(score, 60);
        else if (name.includes(q)) score = Math.max(score, 30);
      }
      if (score >= 0) scored.push({ object, score: score + object.priority * 2 - (object.mag ?? 3) * 0.5 });
    }
    scored.sort((a, b) => b.score - a.score);
    this.matches = scored.slice(0, 8).map(entry => entry.object);
    this.active = 0;
    this.render();
  }

  private render(): void {
    this.results.replaceChildren();
    this.root.classList.toggle('has-results', this.matches.length > 0 || norm(this.input.value).length > 0);
    if (!this.matches.length && norm(this.input.value)) {
      const empty = document.createElement('div');
      empty.className = 'search__empty';
      empty.textContent = '图谱里没有找到它';
      this.results.appendChild(empty);
      return;
    }
    this.matches.forEach((object, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `search__row${index === this.active ? ' is-active' : ''}`;
      const name = document.createElement('span');
      name.className = 'search__name';
      name.textContent = object.zh;
      const meta = document.createElement('span');
      meta.className = 'search__meta';
      meta.textContent = `${KIND_LABEL[object.kind]} · ${object.kind === 'sun' ? '原点' : formatDistance(objectDistance(object))}`;
      row.append(name, meta);
      row.addEventListener('click', () => this.choose(object));
      this.results.appendChild(row);
    });
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.matches.length) return;
      this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.matches.length) % this.matches.length;
      this.render();
    } else if (event.key === 'Enter') {
      const object = this.matches[this.active];
      if (object) this.choose(object);
    } else if (event.key === 'Escape') {
      this.clear(true);
    }
  }

  private choose(object: AtlasObject): void {
    this.clear(true);
    this.onSelect(object);
  }

  private clear(resetText: boolean): void {
    if (resetText) {
      this.input.value = '';
      this.input.blur();
    }
    this.matches = [];
    this.results.replaceChildren();
    this.root.classList.remove('has-results');
  }
}
