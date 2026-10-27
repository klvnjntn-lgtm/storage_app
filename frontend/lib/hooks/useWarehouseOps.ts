'use client';

import { useHasModule } from './useHasModule';

// Whether this org may see and choose locations (see lib/locations.ts).
export function useWarehouseOps(): boolean {
  return useHasModule('WAREHOUSE_OPS');
}
