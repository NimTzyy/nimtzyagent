import { createId } from '@/lib/id';
import type { Preset } from '@/core/types';

import { getDatabase } from './index';

interface PresetRow {
  id: string;
  name: string;
  description: string | null;
  body: string;
  updated_at: number;
}

function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    body: row.body,
    updatedAt: row.updated_at,
  };
}

export async function listPresets(): Promise<Preset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PresetRow>('SELECT * FROM presets ORDER BY updated_at DESC');
  return rows.map(toPreset);
}

export async function getPreset(id: string): Promise<Preset | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<PresetRow>('SELECT * FROM presets WHERE id = ?', [id]);
  return row ? toPreset(row) : null;
}

export async function savePreset(input: {
  id?: string;
  name: string;
  description?: string;
  body: string;
}): Promise<Preset> {
  const db = await getDatabase();
  const preset: Preset = {
    id: input.id ?? createId(),
    name: input.name,
    description: input.description,
    body: input.body,
    updatedAt: Date.now(),
  };
  await db.runAsync(
    `INSERT INTO presets (id, name, description, body, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
       body = excluded.body, updated_at = excluded.updated_at`,
    [preset.id, preset.name, preset.description ?? null, preset.body, preset.updatedAt],
  );
  return preset;
}

export async function deletePreset(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM presets WHERE id = ?', [id]);
}
