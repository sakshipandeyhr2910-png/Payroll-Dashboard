import type { PayrollRow } from '../types';
import raw from './entityRows.json';

export const ENTITY_ROWS: Record<string, PayrollRow[]> = raw as unknown as Record<string, PayrollRow[]>;
