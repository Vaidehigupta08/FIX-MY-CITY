import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppDatabase, StoredUser } from "@/lib/types";
import { buildSeedAdminUsers } from "@/lib/server/departments";

const DB_ROOT = process.env.VERCEL ? os.tmpdir() : process.cwd();
const DB_DIRECTORY = path.join(DB_ROOT, "data");
const DB_FILE = path.join(DB_DIRECTORY, "fix-my-city-db.json");

const DEFAULT_DATABASE: AppDatabase = {
  users: [],
  complaints: [],
  whatsappSessions: [],
  whatsappReports: [],
};

let mutationQueue = Promise.resolve();

async function ensureDatabaseFile() {
  await mkdir(DB_DIRECTORY, { recursive: true });

  try {
    await readFile(DB_FILE, "utf8");
  } catch {
    await writeFile(DB_FILE, JSON.stringify(DEFAULT_DATABASE, null, 2), "utf8");
  }
}

async function readRawDatabase(): Promise<AppDatabase> {
  await ensureDatabaseFile();

  try {
    const raw = await readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppDatabase>;

    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      complaints: Array.isArray(parsed.complaints) ? parsed.complaints : [],
      whatsappSessions: Array.isArray(parsed.whatsappSessions)
        ? parsed.whatsappSessions
        : [],
      whatsappReports: Array.isArray(parsed.whatsappReports)
        ? parsed.whatsappReports
        : [],
    };
  } catch {
    return {
      users: [],
      complaints: [],
      whatsappSessions: [],
      whatsappReports: [],
    };
  }
}

async function writeRawDatabase(database: AppDatabase) {
  await ensureDatabaseFile();
  await writeFile(DB_FILE, JSON.stringify(database, null, 2), "utf8");
}

async function ensureSeedData(database: AppDatabase) {
  if (database.users.length === 0 && database.complaints.length === 0) {
    database.users = buildSeedAdminUsers() as StoredUser[];
    database.complaints = [];
    database.whatsappSessions = [];
    database.whatsappReports = [];
    return true;
  }

  const hasLegacyAdmin = database.users.some(
    (user) =>
      user.role === "admin" &&
      (!user.department || user.email === "admin@fixmycity.com" || user.name === "City Admin"),
  );

  if (!hasLegacyAdmin) {
    return false;
  }

  database.users = buildSeedAdminUsers() as StoredUser[];
  database.complaints = [];
  database.whatsappSessions = [];
  database.whatsappReports = [];
  return true;
}

export async function readDatabase() {
  const database = await readRawDatabase();
  const seeded = await ensureSeedData(database);

  if (seeded) {
    await writeRawDatabase(database);
  }

  return database;
}

export async function updateDatabase<T>(
  updater: (database: AppDatabase) => Promise<T> | T,
) {
  let result!: T;
  let capturedError: unknown;

  mutationQueue = mutationQueue.then(async () => {
    const database = await readDatabase();

    try {
      result = await updater(database);
      await writeRawDatabase(database);
    } catch (error) {
      capturedError = error;
    }
  });

  await mutationQueue;

  if (capturedError) {
    throw capturedError;
  }

  return result;
}
