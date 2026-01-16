import { openDB, type IDBPDatabase } from 'idb';
import type { CVData, ParsedCV } from '../types';

const DB_NAME = 'job-applier-onboarding';
const DB_VERSION = 1;
const STORE_NAME = 'cv';

interface CVStoreSchema {
  cv: {
    key: string;
    value: {
      fileName: string;
      fileSize: number;
      blob: Blob;
      textContent: string;
      uploadedAt: string;
      parsed?: ParsedCV;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<CVStoreSchema>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CVStoreSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCV(cv: CVData): Promise<void> {
  const db = await getDB();
  await db.put(
    STORE_NAME,
    {
      fileName: cv.fileName,
      fileSize: cv.fileSize,
      blob: cv.blob,
      textContent: cv.textContent,
      uploadedAt: cv.uploadedAt.toISOString(),
      parsed: cv.parsed,
    },
    'current'
  );
}

export async function loadCV(): Promise<CVData | null> {
  const db = await getDB();
  const stored = await db.get(STORE_NAME, 'current');
  if (!stored) return null;
  return {
    fileName: stored.fileName,
    fileSize: stored.fileSize,
    blob: stored.blob,
    textContent: stored.textContent,
    uploadedAt: new Date(stored.uploadedAt),
    parsed: stored.parsed,
  };
}

export async function deleteCV(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, 'current');
}

