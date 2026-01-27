/**
 * Test Setup - Global mocks for Chrome extension APIs
 */

import { vi } from 'vitest';

// Mock chrome storage API
const mockStorage: Record<string, unknown> = {};

export const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          return { [keys]: mockStorage[keys] };
        }
        const result: Record<string, unknown> = {};
        keys.forEach(key => {
          result[key] = mockStorage[key];
        });
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete mockStorage[key]);
      }),
    },
  },
  tabs: {
    create: vi.fn(async (_options?: { url?: string; active?: boolean }) => ({ id: 1 })),
    get: vi.fn(async () => ({ status: 'complete', url: 'https://example.com' })),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

// @ts-expect-error - mock
globalThis.chrome = chromeMock;

export function clearMockStorage() {
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
}

export function setMockStorage(data: Record<string, unknown>) {
  Object.assign(mockStorage, data);
}

export function getMockStorage() {
  return { ...mockStorage };
}





